import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertNonProductionDatabaseCommand } from './database-command-safety';

config({ path: resolve(__dirname, '../../../../.env'), quiet: true });
config({ path: resolve(__dirname, '../../.env'), quiet: true });

assertNonProductionDatabaseCommand(process.env.NODE_ENV, 'Database reset');

const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(executable, ['exec', 'prisma', 'migrate', 'reset', '--force'], {
  cwd: resolve(__dirname, '../..'),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
