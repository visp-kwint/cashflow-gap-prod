// server/src/server.js
// Запуск сервера (WP-6 §1): конфигурация — из единого env, логгер — из utils/logger.js.
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

app.listen(env.PORT, () => {
  logger.info('server_started', { port: env.PORT });
  logger.info('api_available', { url: `http://localhost:${env.PORT}/api` });
});
