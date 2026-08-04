import { PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Emergency MFA reset is allowed only in NODE_ENV=production');
  }
  if (process.env.ALLOW_EMERGENCY_MFA_RESET !== 'true') {
    throw new Error('Set ALLOW_EMERGENCY_MFA_RESET=true for this single command');
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('ADMIN_EMAIL is required');

  const prompt = createInterface({ input: stdin, output: stdout });
  const confirmation =
    process.env.ADMIN_MFA_RESET_CONFIRMATION ||
    (await prompt.question(`Type "RESET MFA ${email}" to continue: `));
  prompt.close();
  if (confirmation !== `RESET MFA ${email}`) throw new Error('Confirmation did not match');

  const prisma = new PrismaClient();
  try {
    const admin = await prisma.user.findUnique({ where: { email } });
    if (!admin || admin.role !== UserRole.ADMIN) throw new Error('ADMIN account not found');
    await prisma.$transaction(async (tx) => {
      await tx.adminRecoveryCode.deleteMany({ where: { userId: admin.id } });
      await tx.authSession.updateMany({
        where: { userId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.user.update({
        where: { id: admin.id },
        data: {
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          mfaEnrolledAt: null,
          mustChangePassword: true,
          sessionVersion: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: admin.id,
          action: 'ADMIN_MFA_EMERGENCY_RESET',
          entityType: 'User',
          entityId: admin.id,
          requestId: `cli-${randomUUID()}`,
          metadata: {
            source: 'physical-production-cli',
            sessionsRevoked: true,
            requiresPasswordChange: true,
          },
        },
      });
    });
    stdout.write('MFA reset completed. All admin sessions were revoked.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'MFA reset failed'}\n`);
  process.exitCode = 1;
});
