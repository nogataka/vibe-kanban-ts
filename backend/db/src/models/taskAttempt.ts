import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { 
  TaskAttempt,
  TaskAttemptContext,
  CreateTaskAttempt,
  TaskAttemptError,
  CreatePrParams,
  AttemptResumeContext,
  Task,
  Project
} from './types';
import { TaskModel } from './task';
import { ProjectModel } from './project';

export class TaskAttemptModel {
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

  private mapDbToTaskAttempt(row: any): TaskAttempt {
    return {
      id: this.bufferToUuid(row.id),
      task_id: this.bufferToUuid(row.task_id),
      container_ref: row.container_ref || undefined,
      branch: row.branch || undefined,
      base_branch: row.base_branch,
      profile: row.profile,
      worktree_deleted: Boolean(row.worktree_deleted),
      setup_completed_at: row.setup_completed_at ? new Date(row.setup_completed_at) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  async fetchAll(taskId?: string): Promise<TaskAttempt[]> {
    let query = this.db('task_attempts')
      .select('*')
      .orderBy('created_at', 'desc');
    
    if (taskId) {
      query = query.where('task_id', this.uuidToBuffer(taskId));
    }
    
    const rows = await query;
    return rows.map(row => this.mapDbToTaskAttempt(row));
  }

  async loadContext(
    attemptId: string,
    taskId: string,
    projectId: string,
    taskModel: TaskModel,
    projectModel: ProjectModel
  ): Promise<TaskAttemptContext> {
    // Single query with JOIN validation to ensure proper relationships
    const row = await this.db.raw(`
      SELECT ta.id, ta.task_id, ta.container_ref, ta.branch, ta.base_branch, ta.profile, 
             ta.worktree_deleted, ta.setup_completed_at, ta.created_at, ta.updated_at
      FROM task_attempts ta
      JOIN tasks t ON ta.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      WHERE ta.id = ? AND t.id = ? AND p.id = ?
    `, [this.uuidToBuffer(attemptId), this.uuidToBuffer(taskId), this.uuidToBuffer(projectId)]);

    if (!row || row.length === 0) {
      throw new TaskAttemptError('Task attempt not found or invalid relationship', 'TASK_NOT_FOUND');
    }

    const taskAttempt = this.mapDbToTaskAttempt(row[0]);

    // Load task and project (we know they exist due to JOIN validation)
    const task = await taskModel.findById(taskId);
    if (!task) {
      throw new TaskAttemptError('Task not found', 'TASK_NOT_FOUND');
    }

    const project = await projectModel.findById(projectId);
    if (!project) {
      throw new TaskAttemptError('Project not found', 'PROJECT_NOT_FOUND');
    }

    return {
      task_attempt: taskAttempt,
      task,
      project
    };
  }

  async updateContainerRef(attemptId: string, containerRef: string): Promise<void> {
    const now = new Date();
    await this.db('task_attempts')
      .where('id', this.uuidToBuffer(attemptId))
      .update({
        container_ref: containerRef,
        updated_at: now
      });
  }

  async updateBranch(attemptId: string, branch: string): Promise<void> {
    const now = new Date();
    await this.db('task_attempts')
      .where('id', this.uuidToBuffer(attemptId))
      .update({
        branch: branch,
        updated_at: now
      });
  }

  async markWorktreeDeleted(attemptId: string): Promise<void> {
    await this.db('task_attempts')
      .where('id', this.uuidToBuffer(attemptId))
      .update({
        worktree_deleted: true,
        updated_at: new Date()
      });
  }

  async findById(id: string): Promise<TaskAttempt | null> {
    const row = await this.db('task_attempts')
      .where('id', this.uuidToBuffer(id))
      .first();
    
    return row ? this.mapDbToTaskAttempt(row) : null;
  }

  async findByRowid(rowid: number): Promise<TaskAttempt | null> {
    const row = await this.db('task_attempts')
      .where('rowid', rowid)
      .first();
    
    return row ? this.mapDbToTaskAttempt(row) : null;
  }

  async findByTaskIdWithProject(taskId: string): Promise<Array<{attemptId: string, containerRef: string | null, gitRepoPath: string}>> {
    const rows = await this.db.raw(`
      SELECT ta.id as attempt_id, ta.container_ref, p.git_repo_path
      FROM task_attempts ta
      JOIN tasks t ON ta.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      WHERE ta.task_id = ?
    `, [this.uuidToBuffer(taskId)]);

    return rows.map((r: any) => ({
      attemptId: this.bufferToUuid(r.attempt_id),
      containerRef: r.container_ref,
      gitRepoPath: r.git_repo_path
    }));
  }

  async findByWorktreeDeleted(): Promise<Array<{id: string, containerRef: string}>> {
    const rows = await this.db('task_attempts')
      .select('id', 'container_ref')
      .where('worktree_deleted', false)
      .whereNotNull('container_ref');

    return rows.map(r => ({
      id: this.bufferToUuid(r.id),
      containerRef: r.container_ref
    }));
  }

  async containerRefExists(containerRef: string): Promise<boolean> {
    const result = await this.db('task_attempts')
      .where('container_ref', containerRef)
      .count('* as count')
      .first();

    return result ? Number(result.count) > 0 : false;
  }

  async findExpiredForCleanup(): Promise<Array<{attemptId: string, containerRef: string, gitRepoPath: string}>> {
    // Find task attempts that are expired (72+ hours since last activity) and eligible for worktree cleanup
    const rows = await this.db.raw(`
      SELECT ta.id as attempt_id, ta.container_ref, p.git_repo_path
      FROM task_attempts ta
      LEFT JOIN execution_processes ep ON ta.id = ep.task_attempt_id AND ep.completed_at IS NOT NULL
      JOIN tasks t ON ta.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      WHERE ta.worktree_deleted = 0
          -- Exclude attempts with any running processes (in progress)
          AND ta.id NOT IN (
              SELECT DISTINCT ep2.task_attempt_id
              FROM execution_processes ep2
              WHERE ep2.completed_at IS NULL
          )
      GROUP BY ta.id, ta.container_ref, p.git_repo_path, ta.updated_at
      HAVING datetime('now', '-72 hours') > datetime(
          MAX(
              CASE
                  WHEN ep.completed_at IS NOT NULL THEN ep.completed_at
                  ELSE ta.updated_at
              END
          )
      )
      ORDER BY MAX(
          CASE
              WHEN ep.completed_at IS NOT NULL THEN ep.completed_at
              ELSE ta.updated_at
          END
      ) ASC
    `);

    return rows
      .filter((r: any) => r.container_ref)
      .map((r: any) => ({
        attemptId: this.bufferToUuid(r.attempt_id),
        containerRef: r.container_ref,
        gitRepoPath: r.git_repo_path
      }));
  }

  async create(data: CreateTaskAttempt, taskId: string): Promise<TaskAttempt> {
    const attemptId = uuidv4();
    const now = new Date();

    await this.db('task_attempts').insert({
      id: this.uuidToBuffer(attemptId),
      task_id: this.uuidToBuffer(taskId),
      container_ref: null, // Container isn't known yet
      branch: null, // branch name isn't known yet
      base_branch: data.base_branch,
      profile: data.profile,
      worktree_deleted: false,
      setup_completed_at: null,
      created_at: now,
      updated_at: now
    });

    const taskAttempt = await this.findById(attemptId);
    if (!taskAttempt) {
      throw new TaskAttemptError('Failed to create task attempt', 'CREATE_FAILED');
    }

    return taskAttempt;
  }

  async updateBaseBranch(attemptId: string, newBaseBranch: string): Promise<void> {
    await this.db('task_attempts')
      .where('id', this.uuidToBuffer(attemptId))
      .update({
        base_branch: newBaseBranch,
        updated_at: new Date()
      });
  }

  async resolveContainerRef(containerRef: string): Promise<{attemptId: string, taskId: string, projectId: string}> {
    const result = await this.db.raw(`
      SELECT ta.id as attempt_id, ta.task_id, t.project_id
      FROM task_attempts ta
      JOIN tasks t ON ta.task_id = t.id
      WHERE ta.container_ref = ?
    `, [containerRef]);

    if (!result || result.length === 0) {
      throw new Error('Container reference not found');
    }

    const row = result[0];
    return {
      attemptId: this.bufferToUuid(row.attempt_id),
      taskId: this.bufferToUuid(row.task_id),
      projectId: this.bufferToUuid(row.project_id)
    };
  }

  async markSetupCompleted(attemptId: string): Promise<void> {
    await this.db('task_attempts')
      .where('id', this.uuidToBuffer(attemptId))
      .update({
        setup_completed_at: new Date(),
        updated_at: new Date()
      });
  }

  // Get parent task (requires TaskModel)
  async getParentTask(taskAttempt: TaskAttempt, taskModel: TaskModel): Promise<Task | null> {
    return await taskModel.findById(taskAttempt.task_id);
  }

  async findByTaskId(taskId: string): Promise<TaskAttempt[]> {
    const rows = await this.db('task_attempts')
      .where('task_id', this.uuidToBuffer(taskId))
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToTaskAttempt(row));
  }

  async findAll(): Promise<TaskAttempt[]> {
    const rows = await this.db('task_attempts')
      .select('*')
      .orderBy('created_at', 'desc');
    
    return rows.map(row => this.mapDbToTaskAttempt(row));
  }
}
