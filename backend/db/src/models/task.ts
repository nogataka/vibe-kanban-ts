import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { 
  Task, 
  TaskWithAttemptStatus,
  CreateTask, 
  UpdateTask, 
  TaskStatus,
  Project
} from './types';
import { ProjectModel } from './project';

export class TaskModel {
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

  private mapDbToTask(row: any): Task {
    return {
      id: this.bufferToUuid(row.id),
      project_id: this.bufferToUuid(row.project_id),
      title: row.title,
      description: row.description || undefined,
      status: row.status as TaskStatus,
      parent_task_attempt: row.parent_task_attempt ? this.bufferToUuid(row.parent_task_attempt) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  async findByProjectIdWithAttemptStatus(projectId: string): Promise<TaskWithAttemptStatus[]> {
    // Complex query that matches the Rust implementation
    const rows = await this.db.raw(`
      SELECT
        t.id,
        t.project_id,
        t.title,
        t.description,
        t.status,
        t.parent_task_attempt,
        t.created_at,
        t.updated_at,

        CASE WHEN EXISTS (
          SELECT 1
            FROM task_attempts ta
            JOIN execution_processes ep
              ON ep.task_attempt_id = ta.id
           WHERE ta.task_id = t.id
             AND ep.status = 'running'
             AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
           LIMIT 1
        ) THEN 1 ELSE 0 END AS has_in_progress_attempt,
        
        CASE WHEN (
          SELECT ep.status
            FROM task_attempts ta
            JOIN execution_processes ep
              ON ep.task_attempt_id = ta.id
           WHERE ta.task_id = t.id
           AND ep.run_reason IN ('setupscript','cleanupscript','codingagent')
           ORDER BY ep.created_at DESC
           LIMIT 1
        ) IN ('failed','killed') THEN 1 ELSE 0 END AS last_attempt_failed,

        ( SELECT ta.profile
            FROM task_attempts ta
            WHERE ta.task_id = t.id
           ORDER BY ta.created_at DESC
            LIMIT 1
          ) AS profile

      FROM tasks t
      WHERE t.project_id = ?
      ORDER BY t.created_at DESC
    `, [this.uuidToBuffer(projectId)]);

    return rows.map((row: any) => ({
      id: this.bufferToUuid(row.id),
      project_id: this.bufferToUuid(row.project_id),
      title: row.title,
      description: row.description || undefined,
      status: row.status as TaskStatus,
      parent_task_attempt: row.parent_task_attempt ? this.bufferToUuid(row.parent_task_attempt) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      has_in_progress_attempt: Boolean(row.has_in_progress_attempt),
      has_merged_attempt: false, // TODO: use merges table
      last_attempt_failed: Boolean(row.last_attempt_failed),
      profile: row.profile || 'claude-code'
    }));
  }

  async findById(id: string): Promise<Task | null> {
    const row = await this.db('tasks')
      .where('id', this.uuidToBuffer(id))
      .first();
    
    return row ? this.mapDbToTask(row) : null;
  }

  async findByRowid(rowid: number): Promise<Task | null> {
    const row = await this.db('tasks')
      .where('rowid', rowid)
      .first();
    
    return row ? this.mapDbToTask(row) : null;
  }

  async findByIdAndProjectId(id: string, projectId: string): Promise<Task | null> {
    const row = await this.db('tasks')
      .where('id', this.uuidToBuffer(id))
      .where('project_id', this.uuidToBuffer(projectId))
      .first();
    
    return row ? this.mapDbToTask(row) : null;
  }

  async create(data: CreateTask): Promise<Task> {
    const taskId = uuidv4();
    const now = new Date();

    await this.db('tasks').insert({
      id: this.uuidToBuffer(taskId),
      project_id: this.uuidToBuffer(data.project_id),
      title: data.title,
      description: data.description || null,
      status: TaskStatus.TODO,
      parent_task_attempt: data.parent_task_attempt ? this.uuidToBuffer(data.parent_task_attempt) : null,
      created_at: now,
      updated_at: now
    });

    // Handle image associations if provided
    if (data.image_ids && data.image_ids.length > 0) {
      const imageInserts = data.image_ids.map(imageId => ({
        id: this.uuidToBuffer(uuidv4()),
        task_id: this.uuidToBuffer(taskId),
        image_id: this.uuidToBuffer(imageId),
        created_at: now
      }));

      await this.db('task_images').insert(imageInserts);
    }

    const task = await this.findById(taskId);
    if (!task) {
      throw new Error('Failed to create task');
    }

    return task;
  }

  async update(
    id: string,
    projectId: string,
    title: string,
    description: string | undefined,
    status: TaskStatus,
    parentTaskAttempt: string | undefined
  ): Promise<Task> {
    await this.db('tasks')
      .where('id', this.uuidToBuffer(id))
      .where('project_id', this.uuidToBuffer(projectId))
      .update({
        title,
        description: description || null,
        status,
        parent_task_attempt: parentTaskAttempt ? this.uuidToBuffer(parentTaskAttempt) : null,
        updated_at: new Date()
      });

    const task = await this.findByIdAndProjectId(id, projectId);
    if (!task) {
      throw new Error('Task not found after update');
    }

    return task;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    await this.db('tasks')
      .where('id', this.uuidToBuffer(id))
      .update({
        status,
        updated_at: new Date()
      });
  }

  async delete(id: string): Promise<number> {
    const result = await this.db('tasks')
      .where('id', this.uuidToBuffer(id))
      .del();
    
    return result;
  }

  async exists(id: string, projectId: string): Promise<boolean> {
    const result = await this.db('tasks')
      .where('id', this.uuidToBuffer(id))
      .where('project_id', this.uuidToBuffer(projectId))
      .count('* as count')
      .first();
    
    return result ? Number(result.count) > 0 : false;
  }

  async findRelatedTasksByAttemptId(attemptId: string): Promise<Task[]> {
    // Find both children and parent for this attempt
    const rows = await this.db.raw(`
      SELECT DISTINCT t.id, t.project_id, t.title, t.description, t.status, t.parent_task_attempt, t.created_at, t.updated_at
      FROM tasks t
      WHERE (
          -- Find children: tasks that have this attempt as parent
          t.parent_task_attempt = ?
      ) OR (
          -- Find parent: task that owns the parent attempt of current task
          EXISTS (
              SELECT 1 FROM tasks current_task 
              JOIN task_attempts parent_attempt ON current_task.parent_task_attempt = parent_attempt.id
              WHERE parent_attempt.task_id = t.id 
          )
      )
      -- Exclude the current task itself to prevent circular references
      AND t.id != (SELECT task_id FROM task_attempts WHERE id = ?)
      ORDER BY t.created_at DESC
    `, [this.uuidToBuffer(attemptId), this.uuidToBuffer(attemptId)]);

    return rows.map((row: any) => this.mapDbToTask(row));
  }

  // Convert task to prompt format (from Rust implementation)
  toPrompt(task: Task): string {
    if (task.description) {
      return `Title: ${task.title}\n\nDescription:${task.description}`;
    } else {
      return task.title;
    }
  }

  // Get parent project (requires ProjectModel)
  async getParentProject(task: Task, projectModel: ProjectModel): Promise<Project | null> {
    return await projectModel.findById(task.project_id);
  }

  async findByProjectId(projectId: string): Promise<Task[]> {
    const rows = await this.db('tasks')
      .where('project_id', this.uuidToBuffer(projectId))
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToTask(row));
  }
}
