// ТЗ-доп. (gemini-code): плановые события + интеграции + контрагентные реестры — проверки на уровне кода.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CLIENT = path.resolve(import.meta.dirname, '..');
const SERVER = path.resolve(import.meta.dirname, '..', '..', 'server');

function read(p) {
  if (!existsSync(p)) throw new Error('missing: ' + p);
  return readFileSync(p, 'utf8');
}

const checks = [];
function expect(name, cond) {
  checks.push([name, Boolean(cond)]);
  if (!cond) console.error('FAIL:', name);
}

// 1. Присутствие файлов по структуре ТЗ-доп. §2
expect('client: IntegrationsPanel.tsx', existsSync(CLIENT + '/src/components/IntegrationsPanel.tsx'));
expect('client: PlannedEventsSection.tsx', existsSync(CLIENT + '/src/components/PlannedEventsSection.tsx'));
expect('client: PlannedEventModal.tsx', existsSync(CLIENT + '/src/components/PlannedEventModal.tsx'));
expect('client: CounterpartyShield.tsx', existsSync(CLIENT + '/src/components/CounterpartyShield.tsx'));
expect('server: plannedEvents.routes', existsSync(SERVER + '/src/routes/plannedEvents.routes.js'));
expect('server: integrations.routes', existsSync(SERVER + '/src/routes/integrations.routes.js'));
expect('server: plannedEvents.controller', existsSync(SERVER + '/src/controllers/plannedEvents.controller.js'));
expect('server: integrations.controller', existsSync(SERVER + '/src/controllers/integrations.controller.js'));
expect('server: taxCalendar.service', existsSync(SERVER + '/src/services/taxCalendar.service.js'));
expect('server: counterpartyCheck.service', existsSync(SERVER + '/src/services/counterpartyCheck.service.js'));
expect('server: adapter.interface', existsSync(SERVER + '/src/integrations-stub/adapter.interface.js'));
expect('server: providers.mock', existsSync(SERVER + '/src/integrations-stub/providers.mock.js'));
expect('server: registry.mock', existsSync(SERVER + '/src/integrations-stub/registry.mock.js'));

// 2. Схема БД: модель PlannedEvent со всеми полями из §3
const schema = read(SERVER + '/prisma/schema.prisma');
const plannedBlock = schema.split('model PlannedEvent')[1].split('}')[0];
for (const f of ['type', 'title', 'amount', 'direction', 'expectedDate', 'issueDate', 'deferralDays',
  'prepaymentPct', 'counterpartyName', 'counterpartyInn', 'counterpartyRisk', 'source', 'status', 'active']) {
  expect(`schema: PlannedEvent.${f}`, plannedBlock.includes(`  ${f} `) || plannedBlock.includes(`  ${f}\n`) || plannedBlock.includes(`  ${f} `));
}
// 3. Бизнес-логика по §4
const planned = read(SERVER + '/src/controllers/plannedEvents.controller.js');
expect('split: предоплата+постоплата (0<p<100)', /prepaymentPct\s*!=\s*null/.test(planned) && /Постоплата/.test(planned));
expect('overdue detector', /markOverdueEvents/.test(planned) && /0\.01/.test(planned));
expect('masking applied on create', /maskName\(/.test(planned) && /maskInn\(/.test(planned));
expect('auto-risk on in high/medium', /ensureCounterpartyRisk/.test(planned));

const registry = read(SERVER + '/src/integrations-stub/registry.mock.js');
expect('registry: high suffixes 12/99/66', /\[\s*'12',\s*'99',\s*'66'\s*\]/.test(registry));
expect('registry: p high=0.75', /0\.75/.test(registry));
expect('registry: p medium=0.45', /0\.45/.test(registry));

const tax = read(SERVER + '/src/services/taxCalendar.service.js');
expect('tax: 28th day', /getUTCDate\(\) === 28/.test(tax));
expect('tax: 30% salary, base 65000', /0\.30/.test(tax) && /65000/.test(tax));
expect('tax: demo floor 150k->180k', /150000/.test(tax) && /180000/.test(tax));
expect('tax: quarterly 6%, 50% cap', /0\.06/.test(tax) && /0\.5/.test(tax));

const fc = read(SERVER + '/src/services/forecast.service.js');
expect('forecast: plannedEvents arg', /plannedEvents/.test(fc));
expect('forecast: tax de-dup', /op\.category !== 'tax'/.test(fc));
expect('forecast: MC delay 21d high/medium', /plannedDelayDays/.test(fc) && /plannedDelayProbHigh/.test(fc));
expect('forecast: overdue +7d shift', /plannedOverdueShiftDays/.test(fc));

// 4. Клиент: API-слой и страницы
const apiIdx = read(CLIENT + '/src/api/index.ts');
expect('api: plannedEvents group', /plannedEvents:/.test(apiIdx) && /\/planned-events/.test(apiIdx));
expect('api: integrations.sync', /integrations:/.test(apiIdx) && /\/integrations\/\$/.test(apiIdx));
expect('api: counterparty.check', /counterparty:/.test(apiIdx) && /\/counterparty/.test(apiIdx));
const payments = read(CLIENT + '/src/pages/Payments.tsx');
expect('payments: IntegrationsPanel wired', /<IntegrationsPanel/.test(payments));
expect('payments: PlannedEventsSection wired', /<PlannedEventsSection/.test(payments));
expect('payments: modal wired', /<PlannedEventModal/.test(payments));
const shield = read(CLIENT + '/src/components/CounterpartyShield.tsx');
expect('shield: rose только для high', /red/.test(shield));

const failed = checks.filter(([, ok]) => !ok);
console.log(`addendum checks: ${checks.length - failed.length}/${checks.length} ok`);
if (failed.length) process.exit(1);
