import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { 
  Image,
  TaskImage
} from './types';

export class ImageModel {
  constructor(private db: Knex) {}

  private uuidToBuffer(uuid: string): Buffer {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
  }

  private bufferToUuid(buffer: Buffer): string {
    const hex = buffer.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join('-');
  }

  private mapDbToImage(row: any): Image {
    return {
      id: this.bufferToUuid(row.id),
      file_path: row.file_path,
      original_name: row.original_name,
      mime_type: row.mime_type || undefined,
      size_bytes: row.size_bytes || undefined,
      hash: row.hash,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  private mapDbToTaskImage(row: any): TaskImage {
    return {
      id: this.bufferToUuid(row.id),
      task_id: this.bufferToUuid(row.task_id),
      image_id: this.bufferToUuid(row.image_id),
      created_at: new Date(row.created_at)
    };
  }

  async findById(id: string): Promise<Image | null> {
    const row = await this.db('images')
      .where('id', this.uuidToBuffer(id))
      .first();
    
    return row ? this.mapDbToImage(row) : null;
  }

  async findByHash(hash: string): Promise<Image | null> {
    const row = await this.db('images')
      .where('hash', hash)
      .first();
    
    return row ? this.mapDbToImage(row) : null;
  }

  async findByTaskId(taskId: string): Promise<Image[]> {
    const rows = await this.db('images')
      .join('task_images', 'images.id', 'task_images.image_id')
      .where('task_images.task_id', this.uuidToBuffer(taskId))
      .select('images.*');
    
    return rows.map(row => this.mapDbToImage(row));
  }

  async create(
    filePath: string,
    originalName: string,
    hash: string,
    mimeType?: string,
    sizeBytes?: number
  ): Promise<Image> {
    // Check if image with same hash already exists (deduplication)
    const existing = await this.findByHash(hash);
    if (existing) {
      return existing;
    }

    const imageId = uuidv4();
    const now = new Date();

    await this.db('images').insert({
      id: this.uuidToBuffer(imageId),
      file_path: filePath,
      original_name: originalName,
      mime_type: mimeType || null,
      size_bytes: sizeBytes || null,
      hash: hash,
      created_at: now,
      updated_at: now
    });

    const image = await this.findById(imageId);
    if (!image) {
      throw new Error('Failed to create image');
    }

    return image;
  }

  async delete(id: string): Promise<number> {
    const result = await this.db('images')
      .where('id', this.uuidToBuffer(id))
      .del();
    
    return result;
  }

  // Task-Image association methods
  async associateWithTask(taskId: string, imageId: string): Promise<TaskImage> {
    const associationId = uuidv4();
    const now = new Date();

    await this.db('task_images').insert({
      id: this.uuidToBuffer(associationId),
      task_id: this.uuidToBuffer(taskId),
      image_id: this.uuidToBuffer(imageId),
      created_at: now
    });

    const association = await this.db('task_images')
      .where('id', this.uuidToBuffer(associationId))
      .first();

    if (!association) {
      throw new Error('Failed to create task-image association');
    }

    return this.mapDbToTaskImage(association);
  }

  async dissociateFromTask(taskId: string, imageId: string): Promise<void> {
    await this.db('task_images')
      .where('task_id', this.uuidToBuffer(taskId))
      .where('image_id', this.uuidToBuffer(imageId))
      .del();
  }

  async getTaskAssociations(imageId: string): Promise<TaskImage[]> {
    const rows = await this.db('task_images')
      .where('image_id', this.uuidToBuffer(imageId));
    
    return rows.map(row => this.mapDbToTaskImage(row));
  }

  async updateTaskImages(taskId: string, imageIds: string[]): Promise<void> {
    // Remove existing associations
    await this.db('task_images')
      .where('task_id', this.uuidToBuffer(taskId))
      .del();

    // Add new associations
    if (imageIds.length > 0) {
      const now = new Date();
      const associations = imageIds.map(imageId => ({
        id: this.uuidToBuffer(uuidv4()),
        task_id: this.uuidToBuffer(taskId),
        image_id: this.uuidToBuffer(imageId),
        created_at: now
      }));

      await this.db('task_images').insert(associations);
    }
  }
}
