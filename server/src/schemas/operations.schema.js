// server/src/schemas/operations.schema.js
import { z } from 'zod';
import { SUBCATEGORIES } from '../config/categories.config.js';

const SUBCAT_IDS = SUBCATEGORIES.map((s) => s.id);

/** Явная подкатегория — один из 17 слогов каталога; '' — сброс до null. */
const subcategoryField = z
  .string()
  .refine((v) => v === '' || SUBCAT_IDS.includes(v), {
    message: `subcategory должен быть пустой строкой или одним из: ${SUBCAT_IDS.join(', ')}`,
  })
  .optional();

export const createOperationSchema = {
  body: z.object({
    date: z.string().optional(),
    amount: z.number().positive('Сумма должна быть больше 0'),
    direction: z.enum(['in', 'out']),
    category: z.string().optional(),
    counterpartyName: z.string().optional(),
    counterpartyInn: z.string().optional(),
    purpose: z.string().optional(),
    subcategory: subcategoryField,
  }),
};

/** ТЗ-доработка WP-3 §2.3: PATCH /api/operations/:id { subcategory } (zod + ownership в контроллере). */
export const patchOperationSchema = {
  body: z.object({
    subcategory: z
      .string()
      .refine((v) => v === '' || SUBCAT_IDS.includes(v), {
        message: `subcategory должен быть пустой строкой или одним из: ${SUBCAT_IDS.join(', ')}`,
      }),
  }),
};
