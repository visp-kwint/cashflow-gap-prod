import { useAuthStore } from '@/store/auth';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const BASE: string = import.meta.env.VITE_API_URL ?? '/api';

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/** Человекочитаемое сообщение об ошибке для UI */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return 'Нет соединения с сервером. Проверьте, запущен ли бэкенд.';
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'HTTP_ERROR';
  let message = `Ошибка запроса (${res.status})`;
  try {
    const body = (await res.json()) as ErrorBody;
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // ответ не JSON — оставляем дефолтное сообщение
  }
  return new ApiError(code, message, res.status);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // Для multipart браузер сам выставит Content-Type с boundary
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const err = await parseError(res);
    // 401 от auth- middleware (стандартное тело {error:{code,message}}) — сбрасываем авторизацию.
    // 401 из локальных контроллеров бэка (тело {error: "Unauthorized"}) — показываем ошибку,
    // сессию не рвём (баг поля пользователя на стороне бэка, а не истёкший токен).
    if (res.status === 401 && err.code !== 'HTTP_ERROR') useAuthStore.getState().logout();
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
};
