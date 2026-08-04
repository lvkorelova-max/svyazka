import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const prisma = new PrismaClient();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';

function temporaryPassword(length = 24) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Bootstrap администратора разрешён только при NODE_ENV=production');
  }
  const terminal = createInterface({ input, output });
  try {
    const email = (
      process.env.ADMIN_BOOTSTRAP_EMAIL ||
      (await terminal.question('Email первого администратора: '))
    )
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      throw new Error('Некорректный email администратора');
    }

    const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } });
    const additional = adminCount > 0;
    if (additional && process.env.ALLOW_ADDITIONAL_ADMIN !== 'true') {
      throw new Error(
        'Администратор уже существует. Для дополнительного аккаунта требуется ALLOW_ADDITIONAL_ADMIN=true',
      );
    }
    const phrase = `${additional ? 'CREATE ADDITIONAL ADMIN' : 'CREATE FIRST ADMIN'} ${email}`;
    const confirmation =
      process.env.ADMIN_BOOTSTRAP_CONFIRMATION ||
      (await terminal.question(`Для продолжения введите: ${phrase}\n> `));
    if (confirmation !== phrase) throw new Error('Подтверждение не совпало');

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new Error('Пользователь с таким email уже существует');

    const password = temporaryPassword();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const admin = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          mustChangePassword: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: created.id,
          action: 'ADMIN_BOOTSTRAPPED',
          entityType: 'User',
          entityId: created.id,
          requestId: randomUUID(),
          metadata: { additionalAdmin: additional },
        },
      });
      return created;
    });

    output.write(`Администратор создан: ${admin.email}\n`);
    output.write(`Временный пароль: ${password}\n`);
    output.write('При первом входе обязательны смена пароля и настройка TOTP.\n');
  } finally {
    terminal.close();
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
