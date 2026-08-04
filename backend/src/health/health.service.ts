import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/storage.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private lastAlertSignature = '';
  private lastAlertAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
    private readonly config: ConfigService,
  ) {}

  async readiness() {
    const checkedAt = new Date();
    const dependencies = {
      postgres: await this.checkPostgres(),
      minio: await this.checkMinio(),
      migrations: await this.checkMigrations(),
    };
    const coreReady = Object.values(dependencies).every((item) => item.status === 'READY');
    if (!coreReady) {
      throw new ServiceUnavailableException({
        status: 'NOT_READY',
        checkedAt: checkedAt.toISOString(),
        dependencies,
      });
    }

    const backup = await this.checkBackups(checkedAt);
    const degraded = backup.status !== 'READY';
    if (degraded) {
      await this.emitCriticalAlert('BACKUP_READINESS_DEGRADED', backup);
    }
    return {
      status: degraded ? 'DEGRADED' : 'READY',
      checkedAt: checkedAt.toISOString(),
      dependencies,
      operational: {
        backup,
        invitationsAllowed: !degraded,
      },
    };
  }

  private async checkPostgres() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'READY' as const };
    } catch {
      return { status: 'FAILED' as const, message: 'PostgreSQL unavailable' };
    }
  }

  private async checkMinio() {
    try {
      await this.storage.checkBucket();
      return { status: 'READY' as const };
    } catch {
      return { status: 'FAILED' as const, message: 'MinIO unavailable' };
    }
  }

  private async checkMigrations() {
    try {
      const migrationRoot = resolve(process.cwd(), 'prisma/migrations');
      const entries = await readdir(migrationRoot, { withFileTypes: true });
      const expected = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      const applied = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `;
      const appliedNames = new Set(applied.map((item) => item.migration_name));
      const missing = expected.filter((name) => !appliedNames.has(name));
      return missing.length
        ? { status: 'FAILED' as const, message: 'Pending migrations', missingCount: missing.length }
        : { status: 'READY' as const, appliedCount: applied.length };
    } catch {
      return { status: 'FAILED' as const, message: 'Migration state unavailable' };
    }
  }

  private async checkBackups(now: Date) {
    const maxAgeHours = this.positiveInteger('BACKUP_MAX_AGE_HOURS', 26);
    const threshold = new Date(now.getTime() - maxAgeHours * 3_600_000);
    const latest = await this.prisma.backupRun.findMany({
      where: { status: 'SUCCESS', kind: { in: ['POSTGRES', 'MINIO'] } },
      orderBy: { completedAt: 'desc' },
      distinct: ['kind'],
      select: { kind: true, completedAt: true, snapshotId: true },
    });
    const byKind = new Map(latest.map((item) => [item.kind, item]));
    const missing = ['POSTGRES', 'MINIO'].filter((kind) => {
      const item = byKind.get(kind as 'POSTGRES' | 'MINIO');
      return !item?.completedAt || item.completedAt < threshold;
    });
    if (missing.length) {
      return {
        status: 'DEGRADED' as const,
        message: 'Recent verified backup is missing or stale',
        missingKinds: missing,
        maxAgeHours,
      };
    }
    return {
      status: 'READY' as const,
      maxAgeHours,
      latest: latest.map((item) => ({
        kind: item.kind,
        completedAt: item.completedAt,
        snapshotId: item.snapshotId,
      })),
    };
  }

  private async emitCriticalAlert(action: string, details: unknown) {
    const signature = JSON.stringify({ action, details });
    const now = Date.now();
    if (signature === this.lastAlertSignature && now - this.lastAlertAt < 300_000) return;
    this.lastAlertSignature = signature;
    this.lastAlertAt = now;
    this.logger.error(JSON.stringify({ severity: 'critical', action, details }));
    const url = this.config.get<string>('CRITICAL_ALERT_WEBHOOK_URL');
    if (!url) return;
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.get<string>('CRITICAL_ALERT_WEBHOOK_SECRET')
            ? { authorization: `Bearer ${this.config.get<string>('CRITICAL_ALERT_WEBHOOK_SECRET')}` }
            : {}),
        },
        body: JSON.stringify({ severity: 'critical', action, details, timestamp: new Date().toISOString() }),
      });
    } catch {
      this.logger.error(JSON.stringify({ severity: 'critical', action: 'ALERT_DELIVERY_FAILED' }));
    }
  }

  private positiveInteger(name: string, fallback: number) {
    const value = Number(this.config.get<string>(name) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
