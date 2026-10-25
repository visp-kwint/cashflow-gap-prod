// Гейт: история — читаемый донат и информативный тултип (замены «монолитного кольца»)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'src', 'components', 'charts', 'CategoryPie.tsx');
const src = readFileSync(file, 'utf8');

const checks = [
  // Сегменты отрисовываются без rAF-зависимой анимации (иначе в фоновой вкладке кольцо пустое)
  ['no rAF-dependent entry animation', /isAnimationActive=\{false\}/.test(src)],
  // Детерминированная геометрия: фиксированные px-радиусы, а не проценты от ширины области
  ['fixed px radii', /innerRadius=\{\d+\}/.test(src) && /outerRadius=\{\d+\}/.test(src)],
  // Разделители между сегментами
  ['slice separators', /paddingAngle=\{[3-9]\}/.test(src) && /stroke="#1f2024"/.test(src)],
  // Три оттенка зелёного (шалфей/олива) + серые — сегменты не сливаются (палитра «In Color Balance»)
  ['distinct greens + grays palette',
    ['#9cad76', '#7f915f', '#495736', '#979aa1', '#7c7e86'].every((c) => src.includes(c))],
  // Кастомный тултип: категория, сумма, доля %, всего
  ['rich tooltip with share and total',
    /share/.test(src) && /всего/.test(src) && /formatRub\(value\)/.test(src) && /PieTooltip/.test(src)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok ' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}

if (failed) {
  console.error(`history pie gate: ${failed}/${checks.length} failed`);
  process.exit(1);
}
console.log('history pie gate passed');
