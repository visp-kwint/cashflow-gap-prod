import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G3 oracle: fixed project passes tsc, vite build, eslint.
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd) {
  try {
    execSync(cmd, { cwd: clientDir, stdio: 'pipe', timeout: 300_000 });
    console.log(`ok: ${cmd}`);
  } catch (e) {
    console.error(String(e.stdout || ''));
    console.error(String(e.stderr || ''));
    console.error(`FAIL: ${cmd}`);
    process.exit(1);
  }
}

run('npx tsc');
run('npx vite build --logLevel silent');
run('npx eslint .');
console.log('build verification passed');
