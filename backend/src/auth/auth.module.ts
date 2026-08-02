import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttlSeconds = Number(config.get<string>('ACCESS_TOKEN_TTL_SECONDS') ?? 900);
        if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60) {
          throw new Error('ACCESS_TOKEN_TTL_SECONDS must be an integer of at least 60');
        }
        return {
          secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          signOptions: { expiresIn: ttlSeconds },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, RolesGuard],
  exports: [JwtModule, AccessTokenGuard, RolesGuard],
})
export class AuthModule {}
