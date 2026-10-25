import { sandboxService } from '../services/sandbox.service.js';
import { ApiError } from '../utils/errors.js';

export class SandboxController {
  /** POST /sandbox/simulate { name, amount, date, direction, repeats } */
  async simulate(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();

      const result = await sandboxService.simulate(userId, req.body || {});
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /sandbox/reset — чистим сохранённые карточки сценариев. */
  async reset(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();

      await sandboxService.reset(userId);
      res.json({ message: 'Sandbox reset successfully' });
    } catch (err) {
      next(err);
    }
  }
}

export const sandboxController = new SandboxController();
