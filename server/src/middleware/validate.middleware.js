// server/src/middleware/validate.middleware.js
import { ApiError } from '../utils/errors.js';

export function validate(schema) {
  return (req, res, next) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) req.query = schema.query.parse(req.query);
      if (schema.params) req.params = schema.params.parse(req.params);
      next();
    } catch (error) {
      const message = error.errors ? error.errors.map(e => e.message).join(', ') : 'Ошибка валидации';
      next(ApiError.badRequest(message));
    }
  };
}