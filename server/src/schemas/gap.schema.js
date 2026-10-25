import { z } from 'zod';

export const gapSchema = {
  forecast: z.object({
    horizonMonths: z.number().optional(),
  }),
};