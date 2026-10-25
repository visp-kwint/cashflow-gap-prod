// server/src/routes/operations.routes.js
import { Router } from 'express';
import { getOperations, createOperation, getOperationById, importStatement, bulkImport, reassignOperations, patchOperationCategory } from '../controllers/operations.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { upload, validateFileContent } from '../middleware/upload.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createOperationSchema, patchOperationSchema } from '../schemas/operations.schema.js';

const router = Router();

router.use(authMiddleware);
router.get('/', getOperations);
router.post('/', validate(createOperationSchema), createOperation);
router.post('/import', upload.single('file'), validateFileContent, importStatement);
router.post('/bulk', bulkImport);
router.post('/reassign', reassignOperations);
router.get('/:id', getOperationById);
// ТЗ-доработка WP-3 §2.3: точечная смена подкатегории (zod + ownership)
router.patch('/:id', validate(patchOperationSchema), patchOperationCategory);

export default router;