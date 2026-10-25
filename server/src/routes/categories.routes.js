// server/src/routes/categories.routes.js
// Каталог категорий и подкатегорий (ТЗ-доработка WP-3 §2.1).
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { categoryCatalog } from '../services/categorizer.service.js';

const router = Router();

router.get('/', authMiddleware, (req, res) => {
  res.json(categoryCatalog());
});

export default router;
