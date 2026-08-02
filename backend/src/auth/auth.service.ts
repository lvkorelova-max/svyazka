import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Неверный email или пароль');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Аккаунт заблокирован');
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

  private async createSession(userId: string, metadata: SessionMetadata) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = randomBytes(48).toString('base64url');
    const ttlDays = Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 30);
    const session = await this.prisma.authSession.create({
      data: {
        userId,
        refreshTokenHash: this.hashToken(secret),
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

  private signAccessToken(user: { id: string; role: UserRole; status: UserStatus }) {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, status: user.status };
    return this.jwt.signAsync(payload);
  }

  private publicUser(user: { id: string; email: string; role: UserRole; status: UserStatus }) {
    return { id: user.id, email: user.email, role: user.role, status: user.status };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeTokenMatch(expectedHash: string, token: string) {
    const actualHash = this.hashToken(token);
    return timingSafeEqual(Buffer.from(expectedHash), Buffer.from(actualHash));
  }
}
