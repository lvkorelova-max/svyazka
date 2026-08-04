import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Request } from 'express';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';

type Counter = { count: number; expiresAt: number };

@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly counters = new Map<string, Counter>();
  private readonly cleanupTimer = setInterval(() => this.cleanup(), 60_000);

  constructor(private readonly reflector: Reflector) {
    this.cleanupTimer.unref();
  }

  canActivate(context: ExecutionContext) {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const identity = this.identity(request);
    const key = `${options.scope}:${identity}`;
    const current = this.counters.get(key);
    if (!current || current.expiresAt <= now) {
      this.counters.set(key, {
        count: 1,
        expiresAt: now + options.windowSeconds * 1000,
      });
      return true;
    }
    if (current.count >= options.limit) {
      throw new HttpException(
        'Слишком много запросов. Повторите позже.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    current.count += 1;
    return true;
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  private identity(request: Request) {
    const email =
      typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
    const raw = `${request.ip || 'unknown'}:${email}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, counter] of this.counters) {
      if (counter.expiresAt <= now) this.counters.delete(key);
    }
  }
}
