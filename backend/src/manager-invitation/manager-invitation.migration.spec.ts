import { readFileSync } from 'fs';
import { join } from 'path';

describe('Manager invitation migration safety', () => {
  const migration = readFileSync(
    join(
      __dirname,
      '../../prisma/migrations/20260925010000_manager_invitations/migration.sql',
    ),
    'utf8',
  );

  it('is additive and stores only a token hash', () => {
    expect(migration).toContain('CREATE TABLE "ManagerInvitation"');
    expect(migration).toContain('"tokenHash" CHAR(64) NOT NULL');
    expect(migration).not.toMatch(/"token"\s/);
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE|DROP TABLE|DROP COLUMN)\b/im);
  });

  it('prevents two pending invitations for the same brand and email', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ManagerInvitation_pending_brand_email_key"',
    );
    expect(migration).toContain('WHERE "status" = \'PENDING\'');
  });
});
