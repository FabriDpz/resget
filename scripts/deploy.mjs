// npm run deploy — build del sito + bundle Cloudflare + publish su Pages.
// (Wrapper Node invece di "&&" negli script npm: portabile tra shell Windows.)
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Account personale dalpozzo.business@gmail.com: blocca il deploy su altri
// account (il token OAuth potrebbe averne più d'uno). Id pubblico, non segreto.
process.env.CLOUDFLARE_ACCOUNT_ID = 'fe112f8917fa917595f44152d2fb6059';

execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-cf.mjs')], { stdio: 'inherit', cwd: ROOT });
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
execFileSync(process.execPath, [WRANGLER, 'pages', 'deploy', ...process.argv.slice(2)], {
  stdio: 'inherit', cwd: ROOT,
});