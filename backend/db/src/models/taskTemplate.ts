import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { 
  TaskTemplate,
  CreateTaskTemplate,
  UpdateTaskTemplate
} from './types';

export class TaskTemplateModel {
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

  private mapDbToTaskTemplate(row: any): TaskTemplate {
    return {
      id: this.bufferToUuid(row.id),
      project_id: row.project_id ? this.bufferToUuid(row.project_id) : undefined,
      title: row.title,
      description: row.description || undefined,
      template_name: row.template_name,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  async findAll(): Promise<TaskTemplate[]> {
    const rows = await this.db('task_templates')
      .select('*')
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToTaskTemplate(row));
  }

  async findByProjectId(projectId: string): Promise<TaskTemplate[]> {
    const rows = await this.db('task_templates')
      .where('project_id', this.uuidToBuffer(projectId))
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToTaskTemplate(row));
  }

  async findGlobal(): Promise<TaskTemplate[]> {
    const rows = await this.db('task_templates')
      .whereNull('project_id')
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToTaskTemplate(row));
  }

  async findById(id: string): Promise<TaskTemplate | null> {
    const row = await this.db('task_templates')
      .where('id', this.uuidToBuffer(id))
      .first();
    
    return row ? this.mapDbToTaskTemplate(row) : null;
  }

  async create(data: CreateTaskTemplate): Promise<TaskTemplate> {
    const templateId = uuidv4();
    const now = new Date();

    await this.db('task_templates').insert({
      id: this.uuidToBuffer(templateId),
      project_id: data.project_id ? this.uuidToBuffer(data.project_id) : null,
      title: data.title,
      description: data.description || null,
      template_name: data.template_name,
      created_at: now,
      updated_at: now
    });

    const template = await this.findById(templateId);
    if (!template) {
      throw new Error('Failed to create task template');
    }

    return template;
  }

  async update(id: string, data: UpdateTaskTemplate): Promise<TaskTemplate> {
    await this.db('task_templates')
      .where('id', this.uuidToBuffer(id))
      .update({
        title: data.title,
        description: data.description || null,
        template_name: data.template_name,
        updated_at: new Date()
      });

    const template = await this.findById(id);
    if (!template) {
      throw new Error('Task template not found after update');
    }

    return template;
  }

  async delete(id: string): Promise<number> {
    const result = await this.db('task_templates')
      .where('id', this.uuidToBuffer(id))
      .del();
    
    return result;
  }

  async findByTemplateName(templateName: string, projectId?: string): Promise<TaskTemplate | null> {
    let query = this.db('task_templates')
      .where('template_name', templateName);

    if (projectId) {
      query = query.where('project_id', this.uuidToBuffer(projectId));
    } else {
      query = query.whereNull('project_id');
    }

    const row = await query.first();
    return row ? this.mapDbToTaskTemplate(row) : null;
  }
}
