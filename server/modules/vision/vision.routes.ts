/**
 * Vision API Routes
 *
 * POST /api/vision/analyze  — Analyze one image
 * GET  /api/vision/status   — Provider health + info (diagnostic)
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import multer from 'multer';

import { AppError } from '@/shared/utils.js';

import {
  analyzeImage,
  checkVisionHealth,
  getVisionProviderInfo,
  VisionServiceError,
} from './vision.service.js';

const router = express.Router();

/** MIME types accepted for vision analysis. */
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/** Maximum image size: 10 MB. */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// Ensure upload directory exists
const UPLOAD_DIR = path.join(os.tmpdir(), 'cloudcli-vision');
fs.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const uniqueName = `${randomUUID()}-${Date.now()}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image type: ${file.mimetype}. Only PNG, JPEG, and WebP are allowed.`));
    }
  },
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
  },
});

/** POST /api/vision/analyze */
router.post('/analyze', (req, res, next) => {
  console.log('[Vision] Request received');
  upload.single('image')(req, res, async (err: unknown) => {
    const cleanup = async () => {
      const file = req.file;
      if (file?.path) {
        try { await fs.unlink(file.path); } catch { /* best-effort */ }
      }
    };

    try {
      if (err) {
        console.error('[Vision] Multer error:', err);
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            throw new AppError('Image too large (max 10MB).', {
              code: 'IMAGE_TOO_LARGE', statusCode: 400,
            });
          }
          throw new AppError(`Upload error: ${err.message}`, {
            code: 'UPLOAD_ERROR', statusCode: 400,
          });
        }
        throw err;
      }

      const file = req.file;
      if (!file) {
        throw new AppError('No image file provided.', {
          code: 'IMAGE_REQUIRED', statusCode: 400,
        });
      }

      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        await cleanup();
        throw new AppError(
          `Unsupported image type: ${file.mimetype}. Only PNG, JPEG, and WebP are allowed.`,
          { code: 'UNSUPPORTED_IMAGE_TYPE', statusCode: 400 },
        );
      }

      console.log('[Vision] File received:', file.originalname, file.mimetype, file.size, 'bytes');
      const imageBuffer = await fs.readFile(file.path);

      const body = (req.body ?? {}) as Record<string, unknown>;
      const question = typeof body.question === 'string' ? body.question.trim() : undefined;
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : undefined;
      const forceRefresh = body.forceRefresh === 'true' || body.forceRefresh === true;

      console.log('[Vision] Calling analyzeImage service... question:', question?.slice(0, 50) || '(none)');
      const result = await analyzeImage({
        imageBuffer,
        mimeType: file.mimetype,
        question: question || undefined,
        projectPath: projectPath || undefined,
        forceRefresh,
      });
      console.log('[Vision] Analysis complete, cached:', result.cached);

      await cleanup();
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('[Vision] Error in route handler:', error instanceof Error ? error.message : String(error));
      await cleanup();

      if (error instanceof VisionServiceError) {
        return res.status(mapErrorCodeToStatus(error.code)).json({
          success: false,
          error: { code: error.code, message: error.userMessage },
        });
      }

      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          error: { code: error.code, message: error.message },
        });
      }

      next(error);
    }
  });
});

/** GET /api/vision/status */
router.get('/status', async (_req, res, next) => {
  try {
    const info = getVisionProviderInfo();
    const healthy = info ? await checkVisionHealth() : false;
    res.json({
      success: true,
      data: { configured: info !== null, healthy, provider: info },
    });
  } catch (error) {
    next(error);
  }
});

function mapErrorCodeToStatus(code: string): number {
  switch (code) {
    case 'NO_PROVIDER_CONFIGURED': return 503;
    case 'UNSUPPORTED_IMAGE_TYPE':
    case 'IMAGE_TOO_LARGE':
    case 'INVALID_IMAGE_SIGNATURE': return 400;
    case 'TIMEOUT': return 504;
    case 'NETWORK_ERROR': return 502;
    case 'PARSE_ERROR': return 422;
    default: return 500;
  }
}

export default router;
