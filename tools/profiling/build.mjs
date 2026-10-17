// Builds the extension without minification into .output/profile/chrome-mv3 (see wxt.config.ts), so
// CPU profiles show the real function names. Runs the repository's own build with PROFILE=1.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const result = spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, PROFILE: '1' } });
process.exit(result.status ?? 1);
