// server/src/middleware/rate-limiter.js
// Ограничение частоты (WP-6 §3):
// - authRateLimiter — не более 10 запросов в минуту с одного IP (login/register);
// - apiRateLimiter — общий лимит 300 запросов в минуту на /api.
// При превышении — 429 с типизированным телом {"error":{"code":"RATE_LIMITED","message":"..."}}.
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { ApiError } from '../utils/errors.js';

// Единый обработчик превышения: типизированная ошибка RATE_LIMITED,
// которую централизованный errorHandler отдаёт как 429 JSON.
function rateLimitHandler(req, res, next) {
  next(ApiError.rateLimited());
}

// Явный store, чтобы тесты могли сбрасывать счётчики (ТЗ WP-6 §3 приёмка: «11-й вход за минуту — 429»).
const authStore = new MemoryStore();

export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  store: authStore,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
});

export function resetAuthRateLimiter() {
  void authStore.resetAll();
}

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
});
