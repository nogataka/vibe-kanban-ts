import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { logger } from '../../../utils/src/logger';

const router = Router();

interface ImageResponse {
  id: string;
  file_path: string; // relative path for markdown
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  hash: string;
  created_at: string;
  updated_at: string;
}

// Generate UUID without external dependency
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Ensure images directory exists
async function ensureImagesDirectory(): Promise<string> {
  const imagesDir = path.join(process.cwd(), 'data', 'images');
  await fs.mkdir(imagesDir, { recursive: true });
  return imagesDir;
}

// Calculate file hash
function calculateHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Get MIME type from filename
function getMimeType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return mimeTypes[ext] || null;
}

// POST /api/images/upload
// Rust equivalent: upload_image
// Note: This is a simplified implementation. For production use, install multer:
// npm install multer @types/multer
router.post('/upload', async (req: Request, res: Response) => {
  try {
    // Placeholder implementation - would need multer for proper file upload handling
    res.status(501).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Image upload not yet implemented - requires multer package installation'
    });
  } catch (error) {
    logger.error('Failed to upload image:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to upload image'
    });
  }
});

// GET /api/images/:id/file
// Rust equivalent: serve_image
router.get('/:id/file', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment = req.app.locals.deployment;
    
    if (!deployment) {
      return res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Deployment service not available'
      });
    }

    const image = await deployment.getModels().getImageModel().findById(id);
    
    if (!image) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Image not found'
      });
    }

    const imagesDir = await ensureImagesDirectory();
    const filePath = path.join(imagesDir, image.file_path);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Image file not found on disk'
      });
    }

    // Set appropriate headers
    res.set({
      'Content-Type': image.mime_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      'Content-Length': image.size_bytes.toString(),
    });

    // Stream the file
    const fileBuffer = await fs.readFile(filePath);
    res.send(fileBuffer);

  } catch (error) {
    logger.error('Failed to serve image:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to serve image'
    });
  }
});

// DELETE /api/images/:id
// Rust equivalent: delete_image
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment = req.app.locals.deployment;
    
    if (!deployment) {
      return res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Deployment service not available'
      });
    }

    const image = await deployment.getModels().getImageModel().findById(id);
    
    if (!image) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Image not found'
      });
    }

    // Delete file from disk
    const imagesDir = await ensureImagesDirectory();
    const filePath = path.join(imagesDir, image.file_path);
    
    try {
      await fs.unlink(filePath);
    } catch (error) {
      logger.warn(`Failed to delete image file: ${filePath}`, error);
    }

    // Delete from database using deployment service
    await deployment.getModels().getImageModel().delete(id);

    logger.info(`Image deleted: ${id}`);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });

  } catch (error) {
    logger.error('Failed to delete image:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to delete image'
    });
  }
});

// GET /api/images/task/:task_id
// Rust equivalent: get_task_images
router.get('/task/:task_id', async (req: Request, res: Response) => {
  try {
    const { task_id } = req.params;
    
    // Validate UUID format - Rust returns plain text error for invalid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(task_id)) {
      res.status(400);
      res.type('text/plain');
      return res.send(`Invalid URL: Cannot parse \`task_id\` with value \`${task_id}\`: UUID parsing failed: invalid character: expected an optional prefix of \`urn:uuid:\` followed by [0-9a-fA-F-], found \`${task_id[0]}\` at 1`);
    }
    
    const deployment = req.app.locals.deployment;
    
    if (!deployment) {
      return res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Deployment service not available'
      });
    }

    // Use deployment service to get task images
    const images = await deployment.getModels().getImageModel().findByTaskId(task_id);

    res.json({
      success: true,
      data: images || [],
      error_data: null,
      message: null
    });

  } catch (error) {
    logger.error('Failed to get task images:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get task images'
    });
  }
});

export const imageRoutes = router;
