import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AffiliateRelationshipStatus,
  BrandVerificationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload } from './auth.types';
import {
  BeginMfaEnrollmentDto,
  ConfirmMfaEnrollmentDto,
  VerifyMfaLoginDto,
} from './dto/mfa.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  RequestPasswordResetDto,
} from './dto/password.dto';
import { RegisterDto } from './dto/register.dto';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from './totp';

interface SessionMetadata {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, metadata: SessionMetadata) {
    if (!([UserRole.BRAND, UserRole.CREATOR] as string[]).includes(dto.role)) {
      throw new UnauthorizedException('Эта роль недоступна для регистрации');
    }
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email уже зарегистрирован');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: dto.email, passwordHash, role: dto.role as UserRole },
      });
      if (dto.role === UserRole.BRAND) {
        await tx.brandProfile.create({ data: { userId: created.id, brandName: dto.name.trim() } });
      } else {
        await tx.creatorProfile.create({
          data: { userId: created.id, displayName: dto.name.trim() },
        });
      }
      return created;
    });
    return this.createSession(user.id, metadata);
  }

  async login(dto: LoginDto, metadata: SessionMetadata) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await argon2.hash(dto.password, { type: argon2.argon2id });
      throw new UnauthorizedException('Неверный email или пароль');
    }
    const passwordMatches = user
      ? await argon2.verify(user.passwordHash, dto.password)
      : await this.consumeUnknownUserPassword(dto.password);
    if (!user || !passwordMatches) {
      if (user) await this.recordFailedLogin(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException('Неверный email или пароль');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Аккаунт заблокирован');
    }
    if (user.failedLoginAttempts || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }
    if (user.role === UserRole.ADMIN && user.mfaEnabled) {
      return {
        mfaRequired: true as const,
        challengeToken: await this.jwt.signAsync(
          { sub: user.id, tokenType: 'mfa-challenge' },
          { expiresIn: this.getPositiveInteger('MFA_CHALLENGE_TTL_SECONDS', 300) },
        ),
      };
    }
    return this.createSession(user.id, metadata);
  }

  async refresh(rawToken: string | undefined, metadata: SessionMetadata) {
    if (!rawToken) throw new UnauthorizedException('Refresh-сессия отсутствует');
    const [sessionId, secret] = rawToken.split('.');
    if (!sessionId || !secret) throw new UnauthorizedException('Некорректная refresh-сессия');

    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE ||
      session.sessionVersion !== session.user.sessionVersion ||
      !this.safeTokenMatch(session.refreshTokenHash, secret)
    ) {
      if (session && !session.revokedAt) {
        await this.prisma.authSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh-сессия недействительна');
    }

    const nextSecret = randomBytes(48).toString('base64url');
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.hashToken(nextSecret),
        lastUsedAt: new Date(),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
      },
    });
    return {
      accessToken: await this.signAccessToken(session.user),
      refreshToken: `${session.id}.${nextSecret}`,
      user: this.publicUser(session.user),
    };
  }

  async logout(rawToken?: string) {
    const sessionId = rawToken?.split('.')[0];
    if (sessionId) {
      await this.prisma.authSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { brandProfile: true, creatorProfile: true },
    });
    return {
      ...this.publicUser(user),
      profile: user.brandProfile ?? user.creatorProfile ?? null,
    };
  }

  async requestPasswordReset(dto: RequestPasswordResetDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    let developmentToken: string | undefined;
    if (user?.status === UserStatus.ACTIVE) {
      const token = randomBytes(40).toString('base64url');
      const ttlMinutes = this.getPositiveInteger('PASSWORD_RESET_TTL_MINUTES', 30);
      await this.prisma.$transaction([
        this.prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hashToken(token),
            expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
          },
        }),
      ]);
      await this.deliverPasswordReset(user.email, token);
      if (
        this.config.get<string>('NODE_ENV') !== 'production' &&
        this.config.get<string>('PASSWORD_RESET_EXPOSE_TOKEN') === 'true'
      ) {
        developmentToken = token;
      }
    }
    return {
      message: 'Если аккаунт существует, инструкции по восстановлению отправлены.',
      ...(developmentToken ? { developmentToken } : {}),
    };
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto) {
    const tokenHash = this.hashToken(dto.token);
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date()) {
      throw new BadRequestException('Ссылка восстановления недействительна или истекла');
    }
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.passwordResetToken.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) {
        throw new BadRequestException('Ссылка восстановления уже использована');
      }
      await tx.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      });
      await tx.authSession.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { message: 'Пароль изменён. Выполните вход заново.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Неверный текущий пароль');
    }
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      }),
      this.prisma.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorUserId: user.id,
      action: 'AUTH_PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
    });
    return { message: 'Пароль изменён. Выполните вход заново.' };
  }

  async beginMfaEnrollment(userId: string, dto: BeginMfaEnrollmentDto) {
    const user = await this.requireAdmin(userId);
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Неверный текущий пароль');
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEncrypted: this.encryptSecret(secret), mfaEnabled: false },
    });
    return { secret, otpauthUrl: buildOtpAuthUrl(user.email, secret) };
  }

  async confirmMfaEnrollment(userId: string, dto: ConfirmMfaEnrollmentDto) {
    const user = await this.requireAdmin(userId);
    if (!user.mfaSecretEncrypted) {
      throw new BadRequestException('Сначала начните настройку MFA');
    }
    const secret = this.decryptSecret(user.mfaSecretEncrypted);
    if (!verifyTotp(secret, dto.code)) throw new UnauthorizedException('Неверный код MFA');
    const recoveryCodes = this.generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.adminRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.adminRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({
          userId: user.id,
          codeHash: this.hashRecoveryCode(code),
        })),
      });
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true, mfaEnrolledAt: new Date() },
      });
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'ADMIN_MFA_ENABLED',
      entityType: 'User',
      entityId: user.id,
    });
    return { recoveryCodes };
  }

  async verifyMfaLogin(dto: VerifyMfaLoginDto, metadata: SessionMetadata) {
    let payload: { sub: string; tokenType: string };
    try {
      payload = await this.jwt.verifyAsync(dto.challengeToken);
    } catch {
      throw new UnauthorizedException('MFA challenge недействителен');
    }
    if (payload.tokenType !== 'mfa-challenge') {
      throw new UnauthorizedException('MFA challenge недействителен');
    }
    const user = await this.requireAdmin(payload.sub);
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new UnauthorizedException('MFA не настроена');
    }
    const isTotp = verifyTotp(this.decryptSecret(user.mfaSecretEncrypted), dto.code);
    const recovery = isTotp
      ? null
      : await this.prisma.adminRecoveryCode.findUnique({
          where: { codeHash: this.hashRecoveryCode(dto.code) },
        });
    if (!isTotp && (!recovery || recovery.userId !== user.id || recovery.usedAt)) {
      throw new UnauthorizedException('Неверный код MFA');
    }
    if (recovery) {
      const used = await this.prisma.adminRecoveryCode.updateMany({
        where: { id: recovery.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw new UnauthorizedException('Recovery code уже использован');
      await this.audit.record({
        actorUserId: user.id,
        action: 'ADMIN_MFA_RECOVERY_CODE_USED',
        entityType: 'User',
        entityId: user.id,
      });
    }
    return this.createSession(user.id, metadata);
  }

  async blockUser(adminUserId: string, targetUserId: string, reason?: string) {
    await this.requireAdmin(adminUserId);
    if (adminUserId === targetUserId) {
      throw new BadRequestException('Нельзя заблокировать собственный аккаунт');
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) throw new BadRequestException('Пользователь не найден');
      if (target.status === UserStatus.BLOCKED) return this.publicUser(target);
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          status: UserStatus.BLOCKED,
          sessionVersion: { increment: 1 },
        },
      });
      await tx.authSession.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'USER_BLOCKED',
          entityType: 'User',
          entityId: target.id,
          requestId: this.audit.requestId(),
          metadata: { reason: reason?.trim() || null, role: target.role },
        },
      });
      return this.publicUser(updated);
    });
  }

  async listBrands() {
    return this.prisma.brandProfile.findMany({
      include: {
        user: {
          select: { id: true, email: true, status: true, createdAt: true },
        },
        _count: { select: { offers: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listCreators() {
    return this.prisma.creatorProfile.findMany({
      select: {
        id: true,
        displayName: true,
        description: true,
        user: {
          select: { status: true },
        },
        _count: {
          select: {
            applications: true,
            affiliateRelationships: {
              where: { status: AffiliateRelationshipStatus.ACTIVE },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listApplications() {
    return this.prisma.offerApplication.findMany({
      select: {
        id: true,
        status: true,
        termsStatus: true,
        createdAt: true,
        creator: {
          select: { id: true, displayName: true },
        },
        offer: {
          select: {
            id: true,
            title: true,
            brand: {
              select: { id: true, brandName: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async verifyBrand(adminUserId: string, brandId: string) {
    await this.requireAdmin(adminUserId);
    return this.prisma.$transaction(async (tx) => {
      const brand = await tx.brandProfile.findUnique({ where: { id: brandId } });
      if (!brand) throw new BadRequestException('Бренд не найден');
      if (brand.verificationStatus === BrandVerificationStatus.VERIFIED) {
        return brand;
      }
      const verified = await tx.brandProfile.update({
        where: { id: brand.id },
        data: {
          verificationStatus: BrandVerificationStatus.VERIFIED,
          verifiedAt: new Date(),
          verifiedByUserId: adminUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'BRAND_VERIFIED',
          entityType: 'BrandProfile',
          entityId: brand.id,
          requestId: this.audit.requestId(),
          metadata: { previousStatus: brand.verificationStatus },
        },
      });
      return verified;
    });
  }

  private async createSession(userId: string, metadata: SessionMetadata) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = randomBytes(48).toString('base64url');
    const ttlDays = Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 30);
    const session = await this.prisma.authSession.create({
      data: {
        userId,
        refreshTokenHash: this.hashToken(secret),
        sessionVersion: user.sessionVersion,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
      },
    });
    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: `${session.id}.${secret}`,
      user: this.publicUser(user),
    };
  }

  private signAccessToken(user: {
    id: string;
    role: UserRole;
    status: UserStatus;
    sessionVersion: number;
  }) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      status: user.status,
      sessionVersion: user.sessionVersion,
      tokenType: 'access',
    };
    return this.jwt.signAsync(payload);
  }

  private publicUser(user: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    mustChangePassword?: boolean;
    mfaEnabled?: boolean;
  }) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword ?? false,
      mfaEnabled: user.mfaEnabled ?? false,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeTokenMatch(expectedHash: string, token: string) {
    const actualHash = this.hashToken(token);
    return timingSafeEqual(Buffer.from(expectedHash), Buffer.from(actualHash));
  }

  private async consumeUnknownUserPassword(password: string) {
    await argon2.hash(password, { type: argon2.argon2id });
    return false;
  }

  private async recordFailedLogin(userId: string, previousAttempts: number) {
    const maxAttempts = this.getPositiveInteger('LOGIN_MAX_ATTEMPTS', 5);
    const nextAttempts = previousAttempts + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: nextAttempts >= maxAttempts ? 0 : nextAttempts,
        lockedUntil:
          nextAttempts >= maxAttempts
            ? new Date(
                Date.now() +
                  this.getPositiveInteger('LOGIN_LOCK_MINUTES', 15) * 60_000,
              )
            : null,
      },
    });
  }

  private async deliverPasswordReset(email: string, token: string) {
    const webhookUrl = this.config.get<string>('PASSWORD_RESET_WEBHOOK_URL');
    if (!webhookUrl) return;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.get<string>('PASSWORD_RESET_WEBHOOK_SECRET')
          ? {
              authorization: `Bearer ${this.config.get<string>('PASSWORD_RESET_WEBHOOK_SECRET')}`,
            }
          : {}),
      },
      body: JSON.stringify({
        email,
        token,
        expiresInMinutes: this.getPositiveInteger('PASSWORD_RESET_TTL_MINUTES', 30),
      }),
    });
    if (!response.ok) throw new Error('Password reset delivery failed');
  }

  private async requireAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== UserRole.ADMIN || user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Доступно только администратору');
    }
    return user;
  }

  private encryptSecret(secret: string) {
    const key = this.mfaEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
  }

  private decryptSecret(value: string) {
    const [ivEncoded, tagEncoded, encryptedEncoded] = value.split('.');
    if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error('Invalid MFA secret');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.mfaEncryptionKey(),
      Buffer.from(ivEncoded, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private mfaEncryptionKey() {
    const value = this.config.get<string>('MFA_ENCRYPTION_KEY');
    if (!value) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new Error('MFA_ENCRYPTION_KEY is required in production');
      }
      return createHash('sha256')
        .update('development-only-mfa-key-change-me')
        .digest();
    }
    return createHash('sha256').update(value).digest();
  }

  private hashRecoveryCode(code: string) {
    const pepper =
      this.config.get<string>('MFA_RECOVERY_CODE_SALT') ??
      'development-only-recovery-code-salt';
    return createHmac('sha256', pepper)
      .update(code.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
      .digest('hex');
  }

  private generateRecoveryCodes() {
    return Array.from({ length: 10 }, () => {
      const raw = randomBytes(8).toString('hex').toUpperCase();
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
    });
  }

  private getPositiveInteger(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) ?? fallback);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${key} must be positive`);
    return value;
  }
}
