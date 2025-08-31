import { DatabaseService } from './database';
import { WorktreeManager } from './worktree';
import { logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

export interface TaskAttempt {
  id: string;
  task_id: string;
  worktree_path: string;
  merge_commit?: string;
  executor?: string;
  stdout?: string;
  stderr?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Task {
  id: string;
  project_id: string;
  parent_task_id?: string;
  title: string;
  description?: string;
  status: 'todo' | 'inprogress' | 'done' | 'cancelled' | 'inreview';
  created_at: Date;
  updated_at: Date;
}

export interface Project {
  id: string;
  name: string;
  git_repo_path: string;
  setup_script?: string;
  cleanup_script?: string;
  created_at: Date;
  updated_at: Date;
}

export class DeploymentService {
  private db: DatabaseService;
  private worktreeManager: WorktreeManager;
  private prMonitorInterval?: NodeJS.Timeout;

  constructor(db: DatabaseService) {
    this.db = db;
    this.worktreeManager = new WorktreeManager();
  }

  async initialize(): Promise<void> {
    await this.ensureDefaultProject();
  }

  private async ensureDefaultProject(): Promise<void> {
    const conn = this.db.getConnection();
    const projects = await conn('projects').select('*').limit(1);
    
    if (projects.length === 0) {
      const gitRepoPath = process.cwd();
      await conn('projects').insert({
        id: uuidv4(),
        name: 'Default Project',
        git_repo_path: gitRepoPath,
        setup_script: '',
        cleanup_script: '',
        created_at: new Date(),
        updated_at: new Date()
      });
      logger.info('Created default project');
    }
  }

  async cleanupOrphanExecutions(): Promise<void> {
    if (process.env.DISABLE_WORKTREE_ORPHAN_CLEANUP === '1') {
      logger.info('Worktree orphan cleanup disabled by environment variable');
      return;
    }

    try {
      const conn = this.db.getConnection();
      const attempts = await conn('task_attempts')
        .select('*')
        .whereNotNull('worktree_path');

      for (const attempt of attempts) {
        try {
          const exists = await fs.access(attempt.worktree_path)
            .then(() => true)
            .catch(() => false);

          if (!exists) {
            logger.info(`Cleaning up orphaned task attempt: ${attempt.id}`);
            await conn('task_attempts')
              .where('id', attempt.id)
              .update({ worktree_path: null });
          }
        } catch (error) {
          logger.error(`Failed to check worktree for attempt ${attempt.id}:`, error);
        }
      }

      await this.worktreeManager.cleanupOrphanedWorktrees();
    } catch (error) {
      logger.error('Failed to cleanup orphan executions:', error);
    }
  }

  spawnPRMonitorService(): void {
    this.prMonitorInterval = setInterval(async () => {
      try {
        await this.checkPullRequests();
      } catch (error) {
        logger.error('PR monitor service error:', error);
      }
    }, 60000);
  }

  private async checkPullRequests(): Promise<void> {
    const conn = this.db.getConnection();
    const tasks = await conn('tasks')
      .where('status', 'inreview')
      .select('*');

    for (const task of tasks) {
      logger.debug(`Checking PR status for task: ${task.id}`);
    }
  }

  async trackAnalytics(event: string, properties: Record<string, any>): Promise<void> {
    if (!process.env.POSTHOG_API_KEY) {
      return;
    }

    try {
      logger.debug(`Analytics event: ${event}`, properties);
    } catch (error) {
      logger.error('Failed to track analytics:', error);
    }
  }

  async getProject(projectId: string): Promise<Project | null> {
    const conn = this.db.getConnection();
    const projects = await conn('projects')
      .where('id', projectId)
      .select('*')
      .first();
    return projects || null;
  }

  async getTasks(projectId?: string): Promise<Task[]> {
    const conn = this.db.getConnection();
    let query = conn('tasks').select('*');
    
    if (projectId) {
      query = query.where('project_id', projectId);
    }
    
    return await query;
  }

  async createTask(projectId: string, title: string, description?: string): Promise<Task> {
    const conn = this.db.getConnection();
    const id = uuidv4();
    const now = new Date();

    await conn('tasks').insert({
      id,
      project_id: projectId,
      title,
      description,
      status: 'todo',
      created_at: now,
      updated_at: now
    });

    const task = await conn('tasks').where('id', id).first();
    return task;
  }

  async updateTask(taskId: string, updates: Partial<Task>): Promise<Task | null> {
    const conn = this.db.getConnection();
    await conn('tasks')
      .where('id', taskId)
      .update({
        ...updates,
        updated_at: new Date()
      });

    const task = await conn('tasks').where('id', taskId).first();
    return task || null;
  }

  async createTaskAttempt(taskId: string, worktreePath: string): Promise<TaskAttempt> {
    const conn = this.db.getConnection();
    const id = uuidv4();
    const now = new Date();

    await conn('task_attempts').insert({
      id,
      task_id: taskId,
      worktree_path: worktreePath,
      created_at: now,
      updated_at: now
    });

    const attempt = await conn('task_attempts').where('id', id).first();
    return attempt;
  }

  async cleanup(): Promise<void> {
    if (this.prMonitorInterval) {
      clearInterval(this.prMonitorInterval);
    }
  }
}