// G6 oracle: dark/gray/green palette + Inter + wireframe structure applied.
// Run: node client/scripts/verify-design.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// repo root = parent of client/ (script lives in client/scripts/)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const f = (p) => readFileSync(path.join(root, p), 'utf8');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

// 1) Шрифт Inter подключён через CSS (не через HTML), токен в Tailwind
const css = f('client/src/index.css');
ok(css.includes('@import url(') && css.includes('Inter'), 'index.css: Inter font imported via CSS');
ok(!f('client/index.html').includes('fonts.googleapis'), 'index.html: font links NOT in HTML');
ok(f('client/tailwind.config.js').includes('Inter'), 'tailwind.config.js: Inter in fontFamily');

// 2) Палитра: тёмный фон + серые поверхности + зелёный акцент
ok(css.includes('bg-slate-950') && css.includes('text-slate-100'), 'index.css: dark body (slate-950/slate-100)');
ok(f('client/src/components/ui/Button.tsx').includes('bg-emerald-500'), 'Button: primary = emerald (green)');
ok(f('client/src/components/ui/Card.tsx').includes('bg-slate-900') && f('client/src/components/ui/Card.tsx').includes('border-slate-800'), 'Card: dark surface');
ok(f('client/src/components/ui/Modal.tsx').includes('bg-slate-900'), 'Modal: dark panel');
ok(f('client/src/components/layout/AppLayout.tsx').includes('bg-slate-900/95'), 'AppLayout: dark header');

// 3) Навигация по wireframe: чипы 32×32 + зелёный active
const nav = f('client/src/components/layout/BottomNav.tsx');
ok(nav.includes('h-8 w-8') && nav.includes('bg-emerald-500'), 'BottomNav: 32px chips + emerald active');

// 4) Дашборд: зелёный переключатель горизонта, rose для разрыва
const dash = f('client/src/pages/Dashboard.tsx');
ok(dash.includes('bg-emerald-500 font-medium text-slate-950'), 'Dashboard: horizon switch emerald');
ok(dash.includes('text-rose-400'), 'Dashboard: gap/danger in rose');

// 5) Графики в тёмной палитре
ok(f('client/src/components/charts/ForecastChart.tsx').includes('#3a3b41') && f('client/src/components/charts/ForecastChart.tsx').includes('#b9ca9d'), 'ForecastChart: dark grid + green line');
const pie = f('client/src/components/charts/CategoryPie.tsx');
ok(['#9cad76', '#7f915f', '#495736', '#979aa1', '#7c7e86'].every((c) => pie.includes(c)), 'CategoryPie: In Color Balance palette');

// 6) Остатки светлой темы — только допустимые исключения (белый ползунок Toggle)
const srcDir = path.join(root, 'client/src').split(path.sep).join('/');
function grep(pattern, extra = '') {
  const cmd = `grep -rEn "${pattern}" "${srcDir}" ${extra} 2>nul || exit /b 0`;
  try {
    return execSync(cmd, { shell: 'cmd.exe' }).toString().trim();
  } catch {
    return '';
  }
}

const leftovers = grep(
  'text-slate-900|text-slate-800|border-slate-200|border-slate-300|bg-slate-50|bg-slate-100|bg-red-50|text-red-600|bg-blue-600|text-blue-600|border-blue',
  '--include="*.tsx" --include="*.ts" --include="*.css"',
);
ok(leftovers === '', leftovers === '' ? 'no light-theme class leftovers' : 'leftovers:\n' + leftovers);

const outBgWhite = execSync(
  `grep -rl "bg-white" "${srcDir}" --include="*.tsx" 2>nul | grep -v "Toggle.tsx" || exit /b 0`,
  { shell: 'cmd.exe' },
)
  .toString()
  .trim();
ok(outBgWhite === '', outBgWhite === '' ? 'bg-white only in Toggle thumb (allowed)' : 'bg-white leftovers: ' + outBgWhite);

console.log(failures === 0 ? 'design pass verified' : `DESIGN PASS: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
