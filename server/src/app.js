// server/src/app.js
// (WP-6 §2, §3, §7): helmet, CORS только по CORS_ORIGINS,
// лимитеры частоты, X-Request-Id и HTTP-логирование.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error.middleware.js';
import { apiRateLimiter } from './middleware/rate-limiter.js';
import { corsOrigins } from './config/env.js';
import { logger } from './utils/logger.js';

const app = express();

// Безопасные заголовки.
app.use(helmet());

// CORS: только origins из CORS_ORIGINS (дефолт в разработке — http://localhost:5173).
// Чужой Origin не получит заголовок access-control-allow-origin.
app.use(cors({ origin: corsOrigins }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Идентификатор запроса генерируется на сервере и подставляется в ответ.
// HTTP-лог: метод, путь без query-строки, статус, длительность, requestId, userId, код ошибки.
app.use((req, res, next) => {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();
  res.on('finish', () => {
    const data = {
      method: req.method,
      path: req.baseUrl + req.path, // без query-строки
      status: res.statusCode,
      durationMs: Date.now() - start,
      requestId,
      userId: req.user?.userId ?? null,
    };
    if (req.errorCode) data.errorCode = req.errorCode;
    if (res.statusCode >= 500) logger.error('http', data);
    else if (res.statusCode >= 400) logger.warn('http', data);
    else logger.info('http', data);
  });

  next();
});

// Общий лимит /api — 300 запросов в минуту.
app.use('/api', apiRateLimiter);

// Подключение роутов API
app.use('/api', routes);

// Обработка 404
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Маршрут не найден' } });
});

// Централизованная обработка ошибок
app.use(errorHandler);

export default app;
