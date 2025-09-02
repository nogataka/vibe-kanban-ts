import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DBService } from '../../../../db/src/dbService';
import { logger } from '../../../../utils/src/logger';

export interface CreateImage {
  file_path: string;
  original_name: string;
  mime_type?: string;
  file_size: number;
  hash: string;
}

export interface Image {
  id: string;
  file_path: string;
  original_name: string;
  mime_type?: string;
  file_size: number;
  hash: string;
  created_at: Date;
  updated_at: Date;
}

export class ImageError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ImageError';
  }
}

export class ImageService {
  private cacheDir: string;
  private db: DBService;
  private maxSizeBytes: number;

  constructor(db: DBService) {
    this.db = db;
    this.cacheDir = path.join(process.cwd(), 'data', 'cache', 'images');
    this.maxSizeBytes = 20 * 1024 * 1024; // 20MB default
    this.initializeCacheDir();
  }

  /**
   * Initialize the cache directory
   */
  private async initializeCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create image cache directory:', error);
    }
  }

  /**
   * Store an image from binary data
   */
  async storeImage(data: Buffer, originalFilename: string): Promise<Image> {
    const fileSize = data.length;

    if (fileSize > this.maxSizeBytes) {
      throw new ImageError(
        `Image too large: ${fileSize} bytes (max: ${this.maxSizeBytes} bytes)`,
        'IMAGE_TOO_LARGE'
      );
    }

    // Calculate hash
    const hash = crypto.createHash('sha256').update(data).digest('hex');

    // Extract extension
    const extension = path.extname(originalFilename).toLowerCase() || '.png';
    
    // Determine MIME type
    const mimeType = this.getMimeType(extension);
    if (!mimeType) {
      throw new ImageError('Invalid image format', 'INVALID_FORMAT');
    }

    // Check if image with same hash already exists
    const existingImage = await this.findByHash(hash);
    if (existingImage) {
      logger.debug(`Reusing existing image with hash ${hash}`);
      return existingImage;
    }

    // Generate new filename
    const newFilename = `${uuidv4()}${extension}`;
    const cachedPath = path.join(this.cacheDir, newFilename);

    // Write file to cache
    try {
      await fs.writeFile(cachedPath, data);
    } catch (error) {
      throw new ImageError(`Failed to write image file: ${error}`, 'WRITE_FILE_ERROR');
    }

    // Create database record
    const imageData: CreateImage = {
      file_path: newFilename,
      original_name: originalFilename,
      mime_type: mimeType,
      file_size: fileSize,
      hash
    };

    try {
      const image = await this.createImageRecord(imageData);
      logger.info(`Stored new image: ${originalFilename} (${fileSize} bytes)`);
      return image;
    } catch (error) {
      // Clean up file if database operation failed
      try {
        await fs.unlink(cachedPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Store an image from file path
   */
  async storeImageFromFile(filePath: string): Promise<Image> {
    try {
      const data = await fs.readFile(filePath);
      const originalFilename = path.basename(filePath);
      return await this.storeImage(data, originalFilename);
    } catch (error) {
      throw new ImageError(`Failed to read image file: ${error}`, 'READ_FILE_ERROR');
    }
  }

  /**
   * Get image by ID
   */
  async getImage(imageId: string): Promise<Image | null> {
    try {
      const row = await this.db.getConnection()('images')
        .select('*')
        .where('id', imageId)
        .first();
      
      return row ? this.mapDbToImage(row) : null;
    } catch (error) {
      logger.error('Failed to get image:', error);
      throw new ImageError(`Failed to get image: ${error}`, 'GET_IMAGE_ERROR');
    }
  }

  /**
   * Get image data (binary content)
   */
  async getImageData(imageId: string): Promise<Buffer | null> {
    const image = await this.getImage(imageId);
    if (!image) {
      return null;
    }

    const cachedPath = path.join(this.cacheDir, image.file_path);
    
    try {
      return await fs.readFile(cachedPath);
    } catch (error) {
      logger.error(`Failed to read cached image file ${cachedPath}:`, error);
      throw new ImageError('Image file not found in cache', 'IMAGE_FILE_NOT_FOUND');
    }
  }

  /**
   * Find image by hash
   */
  async findByHash(hash: string): Promise<Image | null> {
    try {
      const row = await this.db.getConnection()('images')
        .select('*')
        .where('hash', hash)
        .first();
      
      return row ? this.mapDbToImage(row) : null;
    } catch (error) {
      logger.error('Failed to find image by hash:', error);
      throw new ImageError(`Failed to find image by hash: ${error}`, 'FIND_BY_HASH_ERROR');
    }
  }

  /**
   * List all images
   */
  async listImages(limit: number = 100, offset: number = 0): Promise<Image[]> {
    try {
      const rows = await this.db.getConnection()('images')
        .select('*')
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);
      
      return rows.map(row => this.mapDbToImage(row));
    } catch (error) {
      logger.error('Failed to list images:', error);
      throw new ImageError(`Failed to list images: ${error}`, 'LIST_IMAGES_ERROR');
    }
  }

  /**
   * Delete an image
   */
  async deleteImage(imageId: string): Promise<boolean> {
    const image = await this.getImage(imageId);
    if (!image) {
      return false;
    }

    try {
      // Delete from database
      const result = await this.db.getConnection()('images')
        .where('id', imageId)
        .del();

      if (result > 0) {
        // Delete file from cache
        const cachedPath = path.join(this.cacheDir, image.file_path);
        try {
          await fs.unlink(cachedPath);
        } catch (error) {
          logger.warn(`Failed to delete cached image file ${cachedPath}:`, error);
          // Continue - database deletion succeeded
        }

        logger.info(`Deleted image: ${image.original_name}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to delete image:', error);
      throw new ImageError(`Failed to delete image: ${error}`, 'DELETE_IMAGE_ERROR');
    }
  }

  /**
   * Get image file path
   */
  async getImagePath(imageId: string): Promise<string | null> {
    const image = await this.getImage(imageId);
    if (!image) {
      return null;
    }

    return path.join(this.cacheDir, image.file_path);
  }

  /**
   * Clean up orphaned images (files without database records)
   */
  async cleanupOrphanedImages(): Promise<number> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const imageFiles = files.filter(file => this.isImageFile(file));
      
      let cleanedCount = 0;

      for (const file of imageFiles) {
        const exists = await this.db.getConnection()('images')
          .select('id')
          .where('file_path', file)
          .first();
        
        if (!exists) {
          const filePath = path.join(this.cacheDir, file);
          try {
            await fs.unlink(filePath);
            cleanedCount++;
            logger.debug(`Cleaned up orphaned image file: ${file}`);
          } catch (error) {
            logger.warn(`Failed to delete orphaned file ${file}:`, error);
          }
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} orphaned image files`);
      }

      return cleanedCount;
    } catch (error) {
      logger.error('Failed to cleanup orphaned images:', error);
      throw new ImageError(`Failed to cleanup orphaned images: ${error}`, 'CLEANUP_ERROR');
    }
  }

  /**
   * Get image statistics
   */
  async getImageStats(): Promise<{
    totalImages: number;
    totalSizeBytes: number;
    averageSizeBytes: number;
    cacheDirectory: string;
  }> {
    try {
      const result = await this.db.getConnection()('images')
        .count('* as count')
        .sum('file_size as total_size')
        .avg('file_size as average_size')
        .first();
      
      return {
        totalImages: result.count || 0,
        totalSizeBytes: result.total_size || 0,
        averageSizeBytes: Math.round(result.average_size || 0),
        cacheDirectory: this.cacheDir
      };
    } catch (error) {
      logger.error('Failed to get image stats:', error);
      throw new ImageError(`Failed to get image stats: ${error}`, 'STATS_ERROR');
    }
  }

  /**
   * Create image database record
   */
  private async createImageRecord(data: CreateImage): Promise<Image> {
    const imageId = uuidv4();
    const now = new Date();

    try {
      await this.db.getConnection()('images').insert({
        id: imageId,
        file_path: data.file_path,
        original_name: data.original_name,
        mime_type: data.mime_type || null,
        file_size: data.file_size,
        hash: data.hash,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      });

      const image = await this.getImage(imageId);
      if (!image) {
        throw new Error('Failed to create image record');
      }

      return image;
    } catch (error) {
      throw new ImageError(`Failed to create image record: ${error}`, 'CREATE_RECORD_ERROR');
    }
  }

  /**
   * Map database row to Image object
   */
  private mapDbToImage(row: any): Image {
    return {
      id: row.id,
      file_path: row.file_path,
      original_name: row.original_name,
      mime_type: row.mime_type || undefined,
      file_size: row.file_size,
      hash: row.hash,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(extension: string): string | null {
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    return mimeTypes[extension.toLowerCase()] || null;
  }

  /**
   * Check if file is an image based on extension
   */
  private isImageFile(filename: string): boolean {
    const extension = path.extname(filename).toLowerCase();
    return this.getMimeType(extension) !== null;
  }

  // UUID conversion methods not needed for Knex.js

  /**
   * Set maximum image size
   */
  setMaxSize(maxSizeBytes: number): void {
    this.maxSizeBytes = maxSizeBytes;
  }

  /**
   * Get maximum image size
   */
  getMaxSize(): number {
    return this.maxSizeBytes;
  }

  /**
   * Check if image exists
   */
  async imageExists(imageId: string): Promise<boolean> {
    const image = await this.getImage(imageId);
    return image !== null;
  }

  /**
   * Cleanup service resources
   */
  cleanup(): void {
    // No persistent resources to cleanup
  }
}
