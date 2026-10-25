// server/src/middleware/auth.middleware.js
// JWT-аутентификация (WP-6 §4): алгоритм HS256 указан явно, секрет — из env.
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Токен авторизации отсутствует'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = decoded; // { userId, email }
    next();
  } catch (e) {
    return next(ApiError.unauthorized('Недействительный или истекший токен'));
  }
}
