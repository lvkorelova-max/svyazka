import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ManagerInvitationStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AcceptNewManagerInvitationDto,
  CreateManagerInvitationDto,
} from './dto/manager-invitation.dto';

const INVITATION_LIST_SELECT = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  acceptedAt: true,
  revokedAt: true,
  acceptedByUserId: true,
} satisfies Prisma.ManagerInvitationSelect;

@Injectable()
export class ManagerInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async create(brandUserId: string, dto: CreateManagerInvitationDto) {
    const brand = await this.requireOwnedBrand(brandUserId);
    const email = this.normalizeEmail(dto.email);
    const displayName = dto.displayName.trim();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      if (
        existingUser.role !== UserRole.MANAGER ||
        existingUser.status !== UserStatus.ACTIVE
      ) {
        throw new BadRequestException('Этот email нельзя пригласить как менеджера');
      }
      const activeAssignment = await this.prisma.brandManagerAssignment.findFirst({
        where: { brandId: brand.id, managerId: existingUser.id, removedAt: null },
        select: { id: true },
      });
      if (activeAssignment) {
        throw new ConflictException('Менеджер уже состоит в команде бренда');
      }
    }

    const rawToken = randomBytes(48).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + this.getPositiveInteger('MANAGER_INVITATION_TTL_DAYS', 7) * 86_400_000,
    );

    try {
      const invitation = await this.prisma.$transaction(
        async (tx) => {
          await this.expirePending(tx, {
            brandId: brand.id,
            email,
          });
          const pending = await tx.managerInvitation.findFirst({
            where: {
              brandId: brand.id,
              email,
              status: ManagerInvitationStatus.PENDING,
            },
            select: { id: true },
          });
          if (pending) {
            throw new ConflictException('Активное приглашение уже существует');
          }
          const created = await tx.managerInvitation.create({
            data: {
              brandId: brand.id,
              email,
              displayName,
              tokenHash,
              expiresAt,
              invitedByUserId: brandUserId,
            },
            select: INVITATION_LIST_SELECT,
          });
          await tx.auditLog.create({
            data: {
              actorUserId: brandUserId,
              action: 'MANAGER_INVITATION_CREATED',
              entityType: 'ManagerInvitation',
              entityId: created.id,
              requestId: this.audit.requestId(),
              metadata: { brandId: brand.id, email },
            },
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return {
        ...invitation,
        invitationUrl: `${this.frontendOrigin()}/manager-invitations/${encodeURIComponent(rawToken)}`,
      };
    } catch (error) {
      this.rethrowInvitationRace(error, 'Активное приглашение уже существует');
    }
  }

  async list(brandUserId: string) {
    const brand = await this.requireOwnedBrand(brandUserId);
    await this.expirePending(this.prisma, { brandId: brand.id });
    return this.prisma.managerInvitation.findMany({
      where: { brandId: brand.id },
      select: INVITATION_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(brandUserId: string, invitationId: string) {
    const brand = await this.requireOwnedBrand(brandUserId);
    return this.prisma.$transaction(async (tx) => {
      await this.expirePending(tx, { id: invitationId, brandId: brand.id });
      const invitation = await tx.managerInvitation.findFirst({
        where: { id: invitationId, brandId: brand.id },
        select: INVITATION_LIST_SELECT,
      });
      if (!invitation) throw new NotFoundException('Приглашение не найдено');
      if (invitation.status !== ManagerInvitationStatus.PENDING) {
        throw new ConflictException('Приглашение уже недоступно');
      }
      const revokedAt = new Date();
      const revoked = await tx.managerInvitation.update({
        where: { id: invitation.id },
        data: { status: ManagerInvitationStatus.REVOKED, revokedAt },
        select: INVITATION_LIST_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: brandUserId,
          action: 'MANAGER_INVITATION_REVOKED',
          entityType: 'ManagerInvitation',
          entityId: invitation.id,
          requestId: this.audit.requestId(),
          metadata: { brandId: brand.id, email: invitation.email },
        },
      });
      return revoked;
    });
  }

  async inspect(rawToken: string) {
    const invitation = await this.findUsableInvitation(rawToken);
    const user = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { role: true },
    });
    return {
      valid: true,
      brand: {
        name: invitation.brand.brandName,
        logoUrl: invitation.brand.logoUrl,
      },
      email: this.maskEmail(invitation.email),
      displayName: invitation.displayName,
      existingManagerAccount: user?.role === UserRole.MANAGER,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptNew(rawToken: string, dto: AcceptNewManagerInvitationDto) {
    const tokenHash = this.hashValidatedToken(rawToken);
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const invitation = await this.requireUsableInvitation(tx, tokenHash);
          const existingUser = await tx.user.findUnique({
            where: { email: invitation.email },
          });
          if (existingUser) {
            if (existingUser.role === UserRole.MANAGER) {
              throw new ConflictException(
                'Войдите в существующий аккаунт менеджера для принятия приглашения',
              );
            }
            throw new ConflictException('Email уже используется другим аккаунтом');
          }

          const user = await tx.user.create({
            data: {
              email: invitation.email,
              passwordHash,
              role: UserRole.MANAGER,
              passwordChangedAt: new Date(),
            },
          });
          await tx.managerProfile.create({
            data: {
              userId: user.id,
              displayName: dto.displayName?.trim() || invitation.displayName,
            },
          });
          const assignment = await tx.brandManagerAssignment.create({
            data: {
              brandId: invitation.brandId,
              managerId: user.id,
              assignedBy: invitation.invitedByUserId,
            },
          });
          await this.markAccepted(tx, invitation.id, user.id);
          await tx.auditLog.create({
            data: {
              actorUserId: user.id,
              action: 'MANAGER_INVITATION_ACCEPTED',
              entityType: 'ManagerInvitation',
              entityId: invitation.id,
              requestId: this.audit.requestId(),
              metadata: {
                brandId: invitation.brandId,
                assignmentId: assignment.id,
                newUser: true,
              },
            },
          });
          return {
            accepted: true,
            userId: user.id,
            brandId: invitation.brandId,
            assignmentId: assignment.id,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.rethrowInvitationRace(error, 'Приглашение уже принято или недоступно');
    }
  }

  async acceptExisting(managerUserId: string, rawToken: string) {
    const tokenHash = this.hashValidatedToken(rawToken);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const invitation = await this.requireUsableInvitation(tx, tokenHash);
          const manager = await tx.user.findUnique({ where: { id: managerUserId } });
          if (
            !manager ||
            manager.role !== UserRole.MANAGER ||
            manager.status !== UserStatus.ACTIVE
          ) {
            throw new ForbiddenException('Доступно только активному менеджеру');
          }
          if (this.normalizeEmail(manager.email) !== invitation.email) {
            throw new ForbiddenException('Приглашение предназначено другому менеджеру');
          }
          const activeAssignment = await tx.brandManagerAssignment.findFirst({
            where: {
              brandId: invitation.brandId,
              managerId: manager.id,
              removedAt: null,
            },
            select: { id: true },
          });
          if (activeAssignment) {
            throw new ConflictException('Менеджер уже состоит в команде бренда');
          }
          await tx.managerProfile.upsert({
            where: { userId: manager.id },
            create: {
              userId: manager.id,
              displayName: invitation.displayName,
            },
            update: {},
          });
          const assignment = await tx.brandManagerAssignment.create({
            data: {
              brandId: invitation.brandId,
              managerId: manager.id,
              assignedBy: invitation.invitedByUserId,
            },
          });
          await this.markAccepted(tx, invitation.id, manager.id);
          await tx.auditLog.create({
            data: {
              actorUserId: manager.id,
              action: 'MANAGER_INVITATION_ACCEPTED',
              entityType: 'ManagerInvitation',
              entityId: invitation.id,
              requestId: this.audit.requestId(),
              metadata: {
                brandId: invitation.brandId,
                assignmentId: assignment.id,
                newUser: false,
              },
            },
          });
          return {
            accepted: true,
            userId: manager.id,
            brandId: invitation.brandId,
            assignmentId: assignment.id,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.rethrowInvitationRace(error, 'Приглашение уже принято или недоступно');
    }
  }

  private async markAccepted(
    tx: Prisma.TransactionClient,
    invitationId: string,
    acceptedByUserId: string,
  ) {
    const acceptedAt = new Date();
    const accepted = await tx.managerInvitation.updateMany({
      where: {
        id: invitationId,
        status: ManagerInvitationStatus.PENDING,
        expiresAt: { gt: acceptedAt },
      },
      data: {
        status: ManagerInvitationStatus.ACCEPTED,
        acceptedAt,
        acceptedByUserId,
      },
    });
    if (accepted.count !== 1) {
      throw new ConflictException('Приглашение уже принято или недоступно');
    }
  }

  private async findUsableInvitation(rawToken: string) {
    const tokenHash = this.hashValidatedToken(rawToken);
    return this.requireUsableInvitation(this.prisma, tokenHash);
  }

  private async requireUsableInvitation(
    client: PrismaService | Prisma.TransactionClient,
    tokenHash: string,
  ) {
    const invitation = await client.managerInvitation.findUnique({
      where: { tokenHash },
      include: {
        brand: {
          select: { id: true, brandName: true, logoUrl: true },
        },
      },
    });
    if (!invitation || invitation.status !== ManagerInvitationStatus.PENDING) {
      throw new NotFoundException('Приглашение недействительно или истекло');
    }
    if (invitation.expiresAt <= new Date()) {
      await client.managerInvitation.updateMany({
        where: {
          id: invitation.id,
          status: ManagerInvitationStatus.PENDING,
        },
        data: { status: ManagerInvitationStatus.EXPIRED },
      });
      throw new NotFoundException('Приглашение недействительно или истекло');
    }
    return invitation;
  }

  private async expirePending(
    client: PrismaService | Prisma.TransactionClient,
    where: Prisma.ManagerInvitationWhereInput,
  ) {
    await client.managerInvitation.updateMany({
      where: {
        ...where,
        status: ManagerInvitationStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: ManagerInvitationStatus.EXPIRED },
    });
  }

  private async requireOwnedBrand(brandUserId: string) {
    const brand = await this.prisma.brandProfile.findUnique({
      where: { userId: brandUserId },
      select: { id: true, brandName: true },
    });
    if (!brand) throw new NotFoundException('Профиль бренда не найден');
    return brand;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private maskEmail(email: string) {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    return `${local.slice(0, 1)}***@${domain}`;
  }

  private hashValidatedToken(token: string) {
    if (
      token.length < 40 ||
      token.length > 200 ||
      !/^[A-Za-z0-9_-]+$/.test(token)
    ) {
      throw new NotFoundException('Приглашение недействительно или истекло');
    }
    return this.hashToken(token);
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private frontendOrigin() {
    return this.config.getOrThrow<string>('FRONTEND_ORIGIN').replace(/\/+$/, '');
  }

  private getPositiveInteger(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) ?? fallback);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${key} must be positive`);
    }
    return value;
  }

  private rethrowInvitationRace(error: unknown, message: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    ) {
      throw new ConflictException(message);
    }
    throw error;
  }
}
