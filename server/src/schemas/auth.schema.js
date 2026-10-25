// server/src/schemas/auth.schema.js
import { z } from 'zod';

export const registerSchema = {
  body: z.object({
    email: z.string().email('Некорректный email'),
    password: z.string().min(8, 'Пароль должен быть не менее 8 символов').max(72, 'Пароль не должен быть длиннее 72 символов'),
    companyName: z.string().min(1, 'Укажите название компании'),
    inn: z.string().regex(/^(\d{10}|\d{12})$/, 'ИНН должен состоять из 10 или 12 цифр'),
    useDemoData: z.union([z.boolean(), z.string()]).optional() // Разрешаем и boolean, и string
  })
};

export const loginSchema = {
  body: z.object({
    email: z.string().email('Некорректный email'),
    password: z.string().min(1, 'Введите пароль')
  })
};