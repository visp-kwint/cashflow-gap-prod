// server/src/utils/logger.js
// Логгер без внешних зависимостей (WP-6 §7): уровни info/warn/error.
// Правила: в лог не попадают тела запросов/ответов, заголовок Authorization,
// query-строка и чувствительные значения; такие поля фильтром заменяются на [REDACTED].
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'email',
  'inn',
  'counterpartyinn',
  'counterpartyname',
  'purpose',
  'amount',
  'balanceendofday',
]);

const REDACTED = '[REDACTED]';

// Глубокое копирование объекта с заменой чувствительных полей на [REDACTED].
function redact(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const key = String(k).toLowerCase();
      out[k] = SENSITIVE_KEYS.has(key) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

function write(level, event, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(data),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (event, data) => write('info', event, data),
  warn: (event, data) => write('warn', event, data),
  error: (event, data) => write('error', event, data),
};
