import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

export default function setup(): void {
  for (const file of ['prisma/test.db', 'prisma/test.db-journal']) rmSync(file, { force: true });
  execSync('npx prisma db push --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  });
}
