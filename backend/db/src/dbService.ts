// Database service - equivalent to Rust's db/src/lib.rs DBService
import { Knex, knex } from 'knex';
import * as path from 'path';
import { assetDir } from '../../utils/src/assets';
import { logger } from '../../utils/src/logger';

export interface DBConfig {
  filename?: string;
  migrations?: {
    directory?: string;
    extension?: string;
  };
}

export class DBService {
  private _pool: Knex;
  private static instance: DBService | null = null;

  private constructor(pool: Knex) {
    this._pool = pool;
  }

  /**
   * Create new DBService instance
   */
  static async new(config?: DBConfig): Promise<DBService> {
    const assetDirPath = await assetDir();
    const dbPath = path.join(assetDirPath, config?.filename || 'db.sqlite');

    const knexConfig: Knex.Config = {
      client: 'sqlite3',
      connection: {
        filename: dbPath
      },
      useNullAsDefault: true,
      migrations: {
        directory: config?.migrations?.directory || path.join(__dirname, '../../db/migrations'),
        extension: config?.migrations?.extension || 'sql'
      },
      pool: {
        afterCreate: function (conn: any, done: any) {
          // Enable foreign key constraints
          conn.run('PRAGMA foreign_keys = ON', done);
        }
      }
    };

    const pool = knex(knexConfig);
    
    // Run migrations
    try {
      await pool.migrate.latest();
      logger.info('Database migrations completed');
    } catch (error) {
      logger.error('Failed to run database migrations:', error);
      throw error;
    }

    return new DBService(pool);
  }

  /**
   * Create new DBService with custom after_connect callback
   */
  static async newWithAfterConnect(
    afterConnect: (connection: any) => Promise<void>,
    config?: DBConfig
  ): Promise<DBService> {
    const assetDirPath = await assetDir();
    const dbPath = path.join(assetDirPath, config?.filename || 'db.sqlite');

    const knexConfig: Knex.Config = {
      client: 'sqlite3',
      connection: {
        filename: dbPath
      },
      useNullAsDefault: true,
      migrations: {
        directory: config?.migrations?.directory || path.join(__dirname, '../../db/migrations'),
        extension: config?.migrations?.extension || 'sql'
      },
      pool: {
        afterCreate: async function (conn: any, done: any) {
          try {
            // Enable foreign key constraints
            conn.run('PRAGMA foreign_keys = ON');
            
            // Call custom after connect callback
            await afterConnect(conn);
            
            done();
          } catch (error) {
            done(error);
          }
        }
      }
    };

    const pool = knex(knexConfig);
    
    // Run migrations
    try {
      await pool.migrate.latest();
      logger.info('Database migrations completed');
    } catch (error) {
      logger.error('Failed to run database migrations:', error);
      throw error;
    }

    return new DBService(pool);
  }

  /**
   * Get singleton instance
   */
  static async getInstance(config?: DBConfig): Promise<DBService> {
    if (!DBService.instance) {
      DBService.instance = await DBService.new(config);
    }
    return DBService.instance;
  }

  /**
   * Get the Knex pool instance
   */
  get pool(): Knex {
    return this._pool;
  }

  /**
   * Get connection for transactions
   */
  getConnection(): Knex {
    return this._pool;
  }

  /**
   * Execute raw SQL query
   */
  async raw<T = any>(query: string, bindings?: any[]): Promise<T> {
    const result = await this._pool.raw(query, bindings);
    return result as T;
  }

  /**
   * Start a transaction
   */
  async transaction<T>(
    callback: (trx: Knex.Transaction) => Promise<T>
  ): Promise<T> {
    return await this._pool.transaction(callback);
  }

  /**
   * Check database connection
   */
  async checkConnection(): Promise<boolean> {
    try {
      await this._pool.raw('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Database connection check failed:', error);
      return false;
    }
  }

  /**
   * Run database migrations
   */
  async runMigrations(): Promise<void> {
    try {
      await this._pool.migrate.latest();
      logger.info('Database migrations completed');
    } catch (error) {
      logger.error('Failed to run migrations:', error);
      throw error;
    }
  }

  /**
   * Rollback database migrations
   */
  async rollbackMigrations(): Promise<void> {
    try {
      await this._pool.migrate.rollback();
      logger.info('Database migrations rolled back');
    } catch (error) {
      logger.error('Failed to rollback migrations:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async getMigrationStatus(): Promise<any> {
    return await this._pool.migrate.currentVersion();
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this._pool) {
      await this._pool.destroy();
      logger.info('Database connection closed');
    }
  }

  /**
   * Reset singleton instance (for testing)
   */
  static reset(): void {
    if (DBService.instance) {
      DBService.instance.close().catch(err => {
        logger.error('Error closing database during reset:', err);
      });
    }
    DBService.instance = null;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    version?: string;
    migrationStatus?: any;
    error?: string;
  }> {
    try {
      const isConnected = await this.checkConnection();
      if (!isConnected) {
        return {
          status: 'unhealthy',
          error: 'Database connection failed'
        };
      }

      const migrationStatus = await this.getMigrationStatus();
      
      return {
        status: 'healthy',
        migrationStatus
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
