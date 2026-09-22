import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

const ALLOWED = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const okExt = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    if (ALLOWED.has(file.mimetype) || okExt) return cb(null, true);
    cb(ApiError.badRequest('Only CSV or Excel files are allowed'));
  },
}).single('file');
