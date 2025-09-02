import knex, { Knex } from 'knex';
import * as path from 'path';
import * as fs from 'fs/promises';
import { logger } from '../../../utils/src/logger';
import { ContainerManager } from './container/containerManager';
import { GitService } from './git/gitService';

export class DatabaseService {
  private static instance: DatabaseService;
  private db: Knex;
  private containerService?: ContainerManager;

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
    
    // Initialize container service
    const gitService = new GitService();
    this.containerService = new ContainerManager(this, gitService);
  }

  private async ensureDataDirectory(): Promise<void> {
    const dataDir = path.join(process.cwd(), 'data');
    await fs.mkdir(dataDir, { recursive: true });
  }

  private async runMigrations(): Promise<void> {
    try {
      await this.db.raw('PRAGMA foreign_keys = ON');
      
      // Check if we need to initialize or migrate
      const hasProjectsTable = await this.db.schema.hasTable('projects');
      
      if (!hasProjectsTable) {
        logger.info('Initializing database with full Rust-compatible schema...');
        await this.createFullSchema();
      } else {
        logger.info('Database exists, checking for schema updates...');
        await this.updateSchema();
      }
      
      logger.info('Database migrations completed successfully');
    } catch (error) {
      logger.error('Failed to run migrations:', error);
      throw error;
    }
  }

  private async createFullSchema(): Promise<void> {
    // Create projects table (matches Rust schema)
    await this.db.schema.createTable('projects', (table) => {
      table.binary('id', 16).primary();
      table.string('name').notNullable();
      table.string('git_repo_path').notNullable().defaultTo('').unique();
      table.text('setup_script').defaultTo('');
      table.text('dev_script').defaultTo('');
      table.text('cleanup_script').defaultTo('');
      table.text('copy_files');
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.timestamp('updated_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
    });

    // Create tasks table (matches Rust schema)
    await this.db.schema.createTable('tasks', (table) => {
      table.binary('id', 16).primary();
      table.binary('project_id', 16).notNullable().references('id').inTable('projects').onDelete('CASCADE');
      table.string('title').notNullable();
      table.text('description');
      table.enum('status', ['todo', 'inprogress', 'done', 'cancelled', 'inreview']).defaultTo('todo');
      table.binary('parent_task_attempt', 16).references('id').inTable('task_attempts');
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.timestamp('updated_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
    });

    // Create task_attempts table (matches latest Rust schema after all migrations)
    await this.db.schema.createTable('task_attempts', (table) => {
      table.binary('id', 16).primary();
      table.binary('task_id', 16).notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('container_ref'); // nullable, renamed from worktree_path in migration 20250726182144
      table.string('branch'); // nullable, added in migration 20250701000000
      table.string('base_branch').notNullable(); // added in migration 20250708000000
      table.string('profile').notNullable(); // renamed from executor in migration 20250813000001
      table.boolean('worktree_deleted').notNullable().defaultTo(false); // added in migration 20250709000000
      table.timestamp('setup_completed_at'); // added in migration 20250710000000
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.timestamp('updated_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      
      // Note: merge_commit, pr_url, pr_number, pr_status, pr_merged_at were REMOVED
      // in migration 20250819000000 and moved to separate 'merges' table
    });

    // Create execution_processes table (latest Rust schema)
    await this.db.schema.createTable('execution_processes', (table) => {
      table.binary('id', 16).primary();
      table.binary('task_attempt_id', 16).notNullable().references('id').inTable('task_attempts').onDelete('CASCADE');
      table.enum('run_reason', ['setupscript', 'cleanupscript', 'codingagent', 'devserver']).notNullable();
      table.json('executor_action').notNullable(); // JSON field for ExecutorAction
      table.enum('status', ['running', 'completed', 'failed', 'killed']).notNullable().defaultTo('running');
      table.integer('exit_code');
      table.timestamp('started_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.timestamp('completed_at');
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.timestamp('updated_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
    });

    // Create executor_sessions table
    await this.db.schema.createTable('executor_sessions', (table) => {
      table.binary('id', 16).primary();
      table.binary('task_attempt_id', 16).notNullable().references('id').inTable('task_attempts').onDelete('CASCADE');
      table.binary('execution_process_id', 16).notNullable().references('id').inTable('execution_processes').onDelete('CASCADE');
      table.string('session_id'); // External session ID from Claude/Amp
      table.text('prompt'); // The prompt sent to the executor
      table.text('summary'); // Final assistant message/summary
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.timestamp('updated_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
    });

    // Create execution_process_logs table
    await this.db.schema.createTable('execution_process_logs', (table) => {
      table.binary('execution_id', 16).primary().references('id').inTable('execution_processes').onDelete('CASCADE');
      table.text('logs').notNullable(); // JSONL format
      table.integer('byte_size').notNullable();
      table.timestamp('inserted_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
    });

    // Create task_templates table
    await this.db.schema.createTable('task_templates', (table) => {
      table.binary('id', 16).primary();
      table.binary('project_id', 16).references('id').inTable('projects').onDelete('CASCADE'); // NULL for global templates
      table.string('title').notNullable();
      table.text('description');
      table.string('template_name').notNullable(); // Display name for the template
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.timestamp('updated_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
    });

    // Create images table (refactored to junction tables)
    await this.db.schema.createTable('images', (table) => {
      table.binary('id', 16).primary();
      table.string('file_path').notNullable(); // relative path within cache/images/
      table.string('original_name').notNullable();
      table.string('mime_type');
      table.integer('size_bytes');
      table.string('hash').notNullable().unique(); // SHA256 for deduplication
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.timestamp('updated_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
    });

    // Create task_images junction table
    await this.db.schema.createTable('task_images', (table) => {
      table.binary('id', 16).primary();
      table.binary('task_id', 16).notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.binary('image_id', 16).notNullable().references('id').inTable('images').onDelete('CASCADE');
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.unique(['task_id', 'image_id']);
    });

    // Create merges table (enhanced with PR and direct merge support, from migration 20250819000000)
    await this.db.schema.createTable('merges', (table) => {
      table.binary('id', 16).primary();
      table.binary('task_attempt_id', 16).notNullable().references('id').inTable('task_attempts').onDelete('CASCADE');
      table.enum('merge_type', ['direct', 'pr']).notNullable();
      
      // Direct merge fields (NULL for PR merges)
      table.string('merge_commit');
      
      // PR merge fields (NULL for direct merges)
      table.integer('pr_number');
      table.string('pr_url');
      table.enum('pr_status', ['open', 'merged', 'closed']);
      table.timestamp('pr_merged_at');
      table.string('pr_merge_commit_sha');
      
      table.timestamp('created_at').notNullable().defaultTo(this.db.raw('CURRENT_TIMESTAMP'));
      table.string('target_branch_name').notNullable();
    });
    
    // Add CHECK constraints to merges table (matching Rust migration)
    await this.db.raw(`
      CREATE TRIGGER merges_type_check_insert BEFORE INSERT ON merges
      BEGIN
        SELECT CASE
          WHEN NEW.merge_type = 'direct' AND 
               (NEW.merge_commit IS NULL OR 
                NEW.pr_number IS NOT NULL OR 
                NEW.pr_url IS NOT NULL OR 
                NEW.pr_status IS NOT NULL)
          THEN RAISE(ABORT, 'Direct merges must have merge_commit and no PR fields')
          WHEN NEW.merge_type = 'pr' AND 
               (NEW.pr_number IS NULL OR 
                NEW.pr_url IS NULL OR 
                NEW.pr_status IS NULL OR 
                NEW.merge_commit IS NOT NULL)
          THEN RAISE(ABORT, 'PR merges must have pr_number, pr_url, pr_status and no merge_commit')
        END;
      END;
    `);
    
    await this.db.raw(`
      CREATE TRIGGER merges_type_check_update BEFORE UPDATE ON merges
      BEGIN
        SELECT CASE
          WHEN NEW.merge_type = 'direct' AND 
               (NEW.merge_commit IS NULL OR 
                NEW.pr_number IS NOT NULL OR 
                NEW.pr_url IS NOT NULL OR 
                NEW.pr_status IS NOT NULL)
          THEN RAISE(ABORT, 'Direct merges must have merge_commit and no PR fields')
          WHEN NEW.merge_type = 'pr' AND 
               (NEW.pr_number IS NULL OR 
                NEW.pr_url IS NULL OR 
                NEW.pr_status IS NULL OR 
                NEW.merge_commit IS NOT NULL)
          THEN RAISE(ABORT, 'PR merges must have pr_number, pr_url, pr_status and no merge_commit')
        END;
      END;
    `);

    // Create indexes
    await this.createIndexes();
  }

  private async updateSchema(): Promise<void> {
    // Simplified schema update - just ensure basic tables exist
    logger.info('Performing basic schema checks and updates...');
    
    try {
      // Check if task_attempts table has the expected structure
      const hasTaskAttemptsTable = await this.db.schema.hasTable('task_attempts');
      if (!hasTaskAttemptsTable) {
        logger.warn('task_attempts table missing, this should not happen');
        return;
      }
      
      // For now, just log that we're skipping detailed column checks
      logger.info('Basic schema validation completed');
      
    } catch (error) {
      logger.warn('Schema update check failed:', error);
      // Don't throw - this is not critical for startup
    }
  }

  private async createIndexes(): Promise<void> {
    // Create indexes to match Rust schema migrations
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_attempt ON tasks(parent_task_attempt)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_execution_processes_task_attempt_id ON execution_processes(task_attempt_id)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_execution_processes_status ON execution_processes(status)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_execution_processes_run_reason ON execution_processes(run_reason)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_executor_sessions_task_attempt_id ON executor_sessions(task_attempt_id)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_executor_sessions_execution_process_id ON executor_sessions(execution_process_id)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_executor_sessions_session_id ON executor_sessions(session_id)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_execution_process_logs_inserted_at ON execution_process_logs(inserted_at)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_task_templates_project_id ON task_templates(project_id)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_images_hash ON images(hash)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_task_images_task_id ON task_images(task_id)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_task_images_image_id ON task_images(image_id)');
    await this.db.raw('CREATE INDEX IF NOT EXISTS idx_merges_task_attempt_id ON merges(task_attempt_id)');
    // Added index from migration 20250819000000
    await this.db.raw(`CREATE INDEX IF NOT EXISTS idx_merges_open_pr ON merges(task_attempt_id, pr_status) 
                        WHERE merge_type = 'pr' AND pr_status = 'open'`);
  }

  getConnection(): Knex {
    return this.db;
  }

  // Helper method to safely add tables without conflicts
  private async addTableIfNotExists(tableName: string, tableBuilder: (table: any) => void): Promise<void> {
    const exists = await this.db.schema.hasTable(tableName);
    if (!exists) {
      logger.info(`Creating new table: ${tableName}`);
      await this.db.schema.createTable(tableName, tableBuilder);
    } else {
      logger.debug(`Table ${tableName} already exists, skipping...`);
    }
  }

  /**
   * Get the Knex instance for direct database access
   */
  getKnex(): Knex {
    return this.db;
  }

  /**
   * Get database connection (alias for getKnex to match DBService interface)
   */
  getConnection(): Knex {
    return this.db;
  }

  /**
   * Get container service instance
   */
  getContainerService(): ContainerManager | undefined {
    return this.containerService;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
    }
  }
}
