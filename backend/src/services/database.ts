import knex, { Knex } from 'knex';
import * as path from 'path';
import * as fs from 'fs/promises';
import { logger } from '../utils/logger';

export class DatabaseService {
  private static instance: DatabaseService;
  private db: Knex;

  private constructor() {
    const dbPath = process.env.DATABASE_URL || path.join(process.cwd(), 'data', 'vibe-kanban.db');
    
    this.db = knex({
      client: 'better-sqlite3',
      connection: {
        filename: dbPath
      },
      useNullAsDefault: true,
      log: {
        warn: (message) => logger.warn(message),
        error: (message) => logger.error(message),
        deprecate: (message) => logger.warn(message),
        debug: (message) => logger.debug(message)
      }
    });
  }

  static async getInstance(): Promise<DatabaseService> {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async initialize(): Promise<void> {
    await this.ensureDataDirectory();
    await this.runMigrations();
  }

  private async ensureDataDirectory(): Promise<void> {
    const dataDir = path.join(process.cwd(), 'data');
    await fs.mkdir(dataDir, { recursive: true });
  }

  private async runMigrations(): Promise<void> {
    try {
      await this.db.raw('PRAGMA foreign_keys = ON');
      
      await this.db.schema.createTableIfNotExists('projects', (table) => {
        table.uuid('id').primary();
        table.string('name').notNullable();
        table.string('git_repo_path').notNullable().defaultTo('').unique();
        table.text('setup_script').defaultTo('');
        table.text('cleanup_script').defaultTo('');
        table.timestamp('created_at').defaultTo(this.db.fn.now());
        table.timestamp('updated_at').defaultTo(this.db.fn.now());
      });

      await this.db.schema.createTableIfNotExists('tasks', (table) => {
        table.uuid('id').primary();
        table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
        table.uuid('parent_task_id').references('id').inTable('tasks').onDelete('CASCADE');
        table.string('title').notNullable();
        table.text('description');
        table.enum('status', ['todo', 'inprogress', 'done', 'cancelled', 'inreview']).defaultTo('todo');
        table.timestamp('created_at').defaultTo(this.db.fn.now());
        table.timestamp('updated_at').defaultTo(this.db.fn.now());
      });

      await this.db.schema.createTableIfNotExists('task_attempts', (table) => {
        table.uuid('id').primary();
        table.uuid('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
        table.string('worktree_path').notNullable();
        table.string('merge_commit');
        table.string('executor');
        table.text('stdout');
        table.text('stderr');
        table.timestamp('created_at').defaultTo(this.db.fn.now());
        table.timestamp('updated_at').defaultTo(this.db.fn.now());
      });

      await this.db.schema.createTableIfNotExists('task_attempt_activities', (table) => {
        table.uuid('id').primary();
        table.uuid('task_attempt_id').notNullable().references('id').inTable('task_attempts').onDelete('CASCADE');
        table.enum('status', [
          'init', 'setuprunning', 'setupcomplete', 'setupfailed',
          'executorrunning', 'executorcomplete', 'executorfailed', 'paused'
        ]).defaultTo('init');
        table.text('note');
        table.timestamp('created_at').defaultTo(this.db.fn.now());
      });

      await this.db.schema.createTableIfNotExists('task_templates', (table) => {
        table.uuid('id').primary();
        table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
        table.string('name').notNullable();
        table.text('description');
        table.text('template_data');
        table.timestamp('created_at').defaultTo(this.db.fn.now());
        table.timestamp('updated_at').defaultTo(this.db.fn.now());
      });

      await this.db.schema.createTableIfNotExists('containers', (table) => {
        table.uuid('id').primary();
        table.string('container_id').notNullable().unique();
        table.string('name').notNullable();
        table.enum('status', ['running', 'stopped', 'error']).defaultTo('stopped');
        table.json('config');
        table.timestamp('created_at').defaultTo(this.db.fn.now());
        table.timestamp('updated_at').defaultTo(this.db.fn.now());
      });

      logger.info('Database migrations completed successfully');
    } catch (error) {
      logger.error('Failed to run migrations:', error);
      throw error;
    }
  }

  getConnection(): Knex {
    return this.db;
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }
}