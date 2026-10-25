// server/src/utils/errors.js
// Типизированные коды ошибок API (WP-6 §6):
// VALIDATION, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, INTERNAL.
export class ApiError extends Error {
  constructor(statusCode, message, code = 'API_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }

  static badRequest(message) {
    return new ApiError(400, message, 'VALIDATION');
  }

  static unauthorized(message = 'Неавторизован', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, code);
  }

  static forbidden(message = 'Доступ запрещён', code = 'FORBIDDEN') {
    return new ApiError(403, message, code);
  }

  static notFound(message = 'Ресурс не найден', code = 'NOT_FOUND') {
    return new ApiError(404, message, code);
  }

  static internal(message = 'Внутренняя ошибка сервера', code = 'INTERNAL') {
    return new ApiError(500, message, code);
  }

  static rateLimited(message = 'Превышен лимит запросов, повторите попытку позже', code = 'RATE_LIMITED') {
    return new ApiError(429, message, code);
  }
}
