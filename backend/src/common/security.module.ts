import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminSecurityGuard } from './guards/admin-security.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';

@Global()
@Module({
  providers: [
    RateLimitGuard,
    AdminSecurityGuard,
    { provide: APP_GUARD, useExisting: RateLimitGuard },
  ],
  exports: [AdminSecurityGuard],
})
export class SecurityModule {}
