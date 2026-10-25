// server/tests/logger.test.js — приёмка WP-6 §7 (TZ §7):
// перехват console и stdout во время серии запросов (регистрация, вход, импорт файла,
// ошибка валидации, ошибка БД) — в выводе нет ни одного из проверочных значений.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Проверочные значения: в логах после серии запросов их быть не должно.
const SENSITIVE = {};

let app, server, base;
let lines = [];

// Перехват console и stdout: всё, что уходит в вывод, попадает в lines.
function startCapture() {
  lines = [];
  const oLog = console.log, oWarn = console.warn, oErr = console.error;
  console.log = (...a) => lines.push(a.map(String).join(' '));
  console.warn = (...a) => lines.push(a.map(String).join(' '));
  console.error = (...a) => lines.push(a.map(String).join(' '));
  const oWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  const oErrWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  return () => {
    console.log = oLog;
    console.warn = oWarn;
    console.error = oErr;
    process.stdout.write = oWrite;
    process.stderr.write = oErrWrite;
  };
}

function multipartCsv(filename, csvText) {
  const boundary = '----logtest-boundary';
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: text/csv\r\n\r\n`;
  return {
    body: `${head}${csvText}\r\n--${boundary}--\r\n`,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  const mod = await import('../src/app.js');
  app = mod.default;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe('WP-6 §7 чувствительные данные не попадают в логи', () => {
  let stopCapture;

  beforeAll(() => {
    stopCapture = startCapture();
  });

  afterAll(() => {
    stopCapture();
  });

  it('после регистрации, входа, импорта, ошибки валидации и ошибки БД в выводе нет секретов', async () => {
    SENSITIVE.password = 'L0g-Test-Passw0rd!x';
    SENSITIVE.email = `logtest${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`;
    SENSITIVE.inn = '770098765432';
    SENSITIVE.purpose = 'Оплата по договору ЛОГТ-2026';
    SENSITIVE.amount = '987654.32';

    // 1) Регистрация.
    const reg = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: SENSITIVE.email,
        password: SENSITIVE.password,
        companyName: 'ЛогТест',
        inn: SENSITIVE.inn,
      }),
    });
    expect(reg.status).toBe(201);
    const regBody = await reg.json();
    SENSITIVE.token = regBody.token;
    expect(reg.headers.get('x-request-id')).toBeTruthy(); // идентификатор запроса генерируется на сервере
    expect(JSON.stringify(regBody)).not.toContain('passwordHash');

    // 2) Вход.
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: SENSITIVE.email, password: SENSITIVE.password }),
    });
    expect(login.status).toBe(200);

    // 3) Импорт файла (CSV формата организаторов) — назначение и сумма из файла.
    const csv =
      'company_id;operation_id;operation_date;amount;direction;counterparty_inn;counterparty_name;payment_purpose;balance_eod\n' +
      `C999;C999-0001;2026-01-05;${SENSITIVE.amount};Списание;${SENSITIVE.inn};ООО «ЛогТест»;${SENSITIVE.purpose};100000.00\n` +
      'C999;C999-0002;2026-01-06;12345.67;Поступление;770098765431;ООО «ЛогТест 2»;Аванс по счёту 42;112345.67';
    const mp = multipartCsv('stmt.csv', csv);
    const imp = await fetch(base + '/api/operations/import', {
      method: 'POST',
      headers: { authorization: `Bearer ${SENSITIVE.token}`, 'content-type': mp.contentType },
      body: mp.body,
    });
    expect(imp.status).toBe(201);
    expect(((await imp.json()).imported ?? 0)).toBeGreaterThanOrEqual(1);

    // 4) Ошибка валидации: чужой email с неверным ИНН-форматом.
    const badReg = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `logbad${Date.now()}@test.local`,
        password: SENSITIVE.password,
        companyName: 'ЛогТест',
        inn: '123',
      }),
    });
    expect(badReg.status).toBe(400);
    expect((await badReg.json()).error.code).toBe('VALIDATION');

    // 5) Ошибка БД: повторная регистрация того же email (P2002).
    const dupReg = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: SENSITIVE.email,
        password: SENSITIVE.password,
        companyName: 'ЛогТест',
        inn: SENSITIVE.inn,
      }),
    });
    expect(dupReg.status).toBe(400);
    expect((await dupReg.json()).error.code).toBe('VALIDATION');

    // В выводе нет ни одного из проверочных значений.
    const out = lines.join('\n');
    for (const [name, value] of Object.entries(SENSITIVE)) {
      expect(out, `значения ${name} нашлось в логах`).not.toContain(String(value));
    }
  });
});
