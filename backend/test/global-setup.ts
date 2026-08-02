import { execFileSync } from 'child_process';

export default function globalSetup() {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://svyazka:local_test_password@localhost:5432/svyazka_test?schema=public';
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    {
      cwd: __dirname + '/..',
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
}
