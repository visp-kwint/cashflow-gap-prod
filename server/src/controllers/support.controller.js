import { prisma } from '../config/db.js';
import { ApiError } from '../utils/errors.js';

export class SupportController {
  /** POST /support/tickets { subject, kind, message } */
  async createTicket(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();

      const { subject, kind, message } = req.body || {};
      if (!subject || !kind || !message) {
        throw ApiError.badRequest('Заполните тему, тип и сообщение обращения');
      }
      if (!['problem', 'question'].includes(kind)) {
        throw ApiError.badRequest('Тип обращения: problem или question');
      }

      const ticket = await prisma.supportTicket.create({
        data: {
          userId,
          subject: String(subject).slice(0, 200),
          kind,
          message: String(message).slice(0, 2000),
        },
      });
      res.status(201).json(ticket);
    } catch (err) {
      next(err);
    }
  }

  /** GET /support/tickets */
  async listTickets(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();

      const tickets = await prisma.supportTicket.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      res.json(tickets);
    } catch (err) {
      next(err);
    }
  }
}

export const supportController = new SupportController();
