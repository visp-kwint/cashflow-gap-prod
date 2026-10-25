// server/src/middleware/upload.middleware.js
// Загрузка файлов (WP-6 §8): лимит 25 МБ, не более 1 файла,
// проверка расширений + проверка содержимого (.xlsx — сигнатура ZIP, .csv — без нулевых байтов).
import multer from 'multer';
import { ApiError } from '../utils/errors.js';

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  // 25 МБ: полный файл all_operations.csv (~222 тыс. строк) тоже проходит
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(csv|xlsx)$/i)) {
      cb(null, true);
    } else {
      cb(ApiError.badRequest('Поддерживаются только форматы CSV и XLSX'));
    }
  }
});

// Проверка содержимого загруженного файла по расширению (WP-6 §8).
// Несовпадение — 400 с кодом VALIDATION и сообщением на русском.
export function validateFileContent(req, res, next) {
  if (!req.file) return next();
  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  const buf = req.file.buffer;

  if (ext === 'xlsx') {
    // XLSX — это ZIP-архив: сигнатура PK\x03\x04 в начале файла.
    const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    if (!isZip) {
      return next(ApiError.badRequest('Содержимое файла не похоже на XLSX (нет ZIP-сигнатуры). Проверьте файл.'));
    }
  } else if (ext === 'csv') {
    // CSV — текст: нулевые байты означают бинарный файл.
    if (buf.includes(0)) {
      return next(ApiError.badRequest('Содержимое файла не похоже на CSV (обнаружены нулевые байты). Проверьте файл.'));
    }
  }

  return next();
}