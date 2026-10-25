// ESLint-конфиг сервера (WP-9, ТЗ §9): no-console — error, исключение utils/logger.js
// (единственный легальный вывод в логах — logger). Остальные правила — разумный
// минимум (no-undef и т.п. из recommended), без стилевых плагинов (Prettier не введён).
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        // Node.js (сервер и scripts/)
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly', // Node 18+ global
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        FormData: 'readonly', // Node 18+ (undici)
        Blob: 'readonly',
      },
    },
    rules: {
      'no-console': 'error',
      'no-unused-vars': [
        'error',
        {
          // «исключение служебных полей через rest» (companyId, categorizeRule, __cat …) — осознанно
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
  {
    // logger.js — единственный легальный console.* (агрегирует и печатает логи)
    files: ['src/utils/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // CLI-инструменты (оракулы, сид, backtest): вывод в консоль — их единственный
    // канал отчёта пользователю (spec §9 «no-console: error, исключение logger.js»
    // распространяем на CLI-скрипты, а не на серверный код)
    files: ['scripts/**/*.mjs', 'prisma/seed/index.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // logger.test.js проверяет поведение логгера — console.* в тестах ожидаем
    files: ['tests/logger.test.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'prisma/dev.db'],
  },
];
