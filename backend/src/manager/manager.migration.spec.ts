import { readFileSync } from 'fs';
import { join } from 'path';

describe('Phase 1 manager migration safety', () => {
  const migration = readFileSync(
    join(
      __dirname,
      '../../prisma/migrations/20260925000000_manager_access_phase1/migration.sql',
    ),
    'utf8',
  );

  it('is additive and leaves legacy ownership and responsibility data untouched', () => {
    expect(migration).toContain("ALTER TYPE \"UserRole\" ADD VALUE IF NOT EXISTS 'MANAGER'");
    expect(migration).toContain('ADD COLUMN "createdByManagerId" UUID');
    expect(migration).toContain('ADD COLUMN "currentManagerId" UUID');
    expect(migration).toContain('ADD COLUMN "managerIdAtAttribution" UUID');
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE|DROP TABLE|DROP COLUMN)\b/im);
  });

  it('uses a partial unique index for active assignments', () => {
    expect(migration).toContain(
      'WHERE "removedAt" IS NULL',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "BrandManagerAssignment_active_brand_manager_key"',
    );
  });
});
