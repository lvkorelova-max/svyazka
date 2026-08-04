import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'cookie',
  'refreshtoken',
  'refreshtokenhash',
  'secret',
  'token',
  'mfasecret',
];

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    requestId?: string;
    metadata?: unknown;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action.slice(0, 120),
        entityType: input.entityType.slice(0, 80),
        entityId: input.entityId.slice(0, 160),
        requestId: (input.requestId || RequestContext.requestId() || randomUUID()).slice(0, 100),
        metadata: this.sanitize(input.metadata) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  requestId() {
    return RequestContext.requestId() || randomUUID();
  }

  private sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEYS.some((term) => key.toLowerCase().includes(term)))
        .map(([key, nested]) => [key, this.sanitize(nested)]),
    );
  }
}
