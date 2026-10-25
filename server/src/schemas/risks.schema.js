import { z } from 'zod';

export const risksSchema = {
  resolve: z.object({
    id: z.string().uuid(),
  }),
};