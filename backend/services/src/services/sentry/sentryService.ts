import * as Sentry from '@sentry/node';
import { logger } from '../../../../utils/src/logger';

export interface SentryUser {
  id?: string;
  username?: string;
  email?: string;
}

export interface SentryContext {
  [key: string]: any;
}

export interface SentryBreadcrumb {
  message?: string;
  category?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  data?: Record<string, any>;
  timestamp?: number;
}

export class SentryService {
  private initialized: boolean = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize Sentry if DSN is provided
   */
  private initialize(): void {
    const sentryDsn = process.env.SENTRY_DSN;
    
    if (!sentryDsn) {
      logger.debug('No Sentry DSN provided, error reporting disabled');
      return;
    }

    try {
      Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.npm_package_version || 'unknown',
        integrations: [
          // Add Node.js specific integrations
          Sentry.httpIntegration(),
          Sentry.expressIntegration(),
          Sentry.consoleIntegration(),
          Sentry.localVariablesIntegration({
            captureAllExceptions: false,
          }),
        ],
        tracesSampleRate: 0.1, // 10% of transactions
        profilesSampleRate: 0.1, // 10% for profiling
        beforeSend(event, hint) {
          // Filter out certain types of errors
          if (event.exception) {
            const error = hint.originalException;
            
            // Skip common/expected errors
            if (error instanceof Error) {
              if (error.message.includes('ENOENT') ||
                  error.message.includes('ECONNREFUSED') ||
                  error.message.includes('SIGTERM') ||
                  error.message.includes('SIGINT')) {
                return null;
              }
            }
          }
          
          return event;
        },
        beforeSendTransaction(event) {
          // Skip certain transactions
          if (event.transaction?.includes('health') ||
              event.transaction?.includes('heartbeat')) {
            return null;
          }
          
          return event;
        }
      });

      this.initialized = true;
      logger.info('Sentry error reporting initialized');

    } catch (error) {
      logger.error('Failed to initialize Sentry:', error);
    }
  }

  /**
   * Update Sentry user scope
   */
  async updateScope(userId: string, username?: string, email?: string): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      Sentry.withScope((scope) => {
        const user: SentryUser = { id: userId };
        
        if (username) {
          user.username = username;
        }
        
        if (email) {
          user.email = email;
        }

        scope.setUser(user);
        
        // Add additional context
        scope.setTag('user_id', userId);
        if (username) {
          scope.setTag('username', username);
        }
      });

      logger.debug(`Updated Sentry scope for user: ${userId}`);

    } catch (error) {
      logger.error('Failed to update Sentry scope:', error);
    }
  }

  /**
   * Capture an exception
   */
  captureException(error: Error, context?: SentryContext): string | undefined {
    if (!this.initialized) {
      return undefined;
    }

    try {
      return Sentry.withScope((scope) => {
        if (context) {
          Object.entries(context).forEach(([key, value]) => {
            scope.setContext(key, value);
          });
        }
        return Sentry.captureException(error);
      });
    } catch (sentryError) {
      logger.error('Failed to capture exception with Sentry:', sentryError);
      return undefined;
    }
  }

  /**
   * Capture a message
   */
  captureMessage(
    message: string, 
    level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
    context?: SentryContext
  ): string | undefined {
    if (!this.initialized) {
      return undefined;
    }

    try {
      return Sentry.withScope((scope) => {
        if (context) {
          Object.entries(context).forEach(([key, value]) => {
            scope.setContext(key, value);
          });
        }
        return Sentry.captureMessage(message, level);
      });
    } catch (error) {
      logger.error('Failed to capture message with Sentry:', error);
      return undefined;
    }
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(breadcrumb: SentryBreadcrumb): void {
    if (!this.initialized) {
      return;
    }

    try {
      Sentry.addBreadcrumb({
        message: breadcrumb.message,
        category: breadcrumb.category,
        level: breadcrumb.level || 'info',
        data: breadcrumb.data,
        timestamp: breadcrumb.timestamp || Date.now() / 1000
      });
    } catch (error) {
      logger.error('Failed to add breadcrumb to Sentry:', error);
    }
  }

  /**
   * Set context data
   */
  setContext(key: string, context: any): void {
    if (!this.initialized) {
      return;
    }

    try {
      Sentry.withScope((scope) => {
        scope.setContext(key, context);
      });
    } catch (error) {
      logger.error('Failed to set Sentry context:', error);
    }
  }

  /**
   * Set tag
   */
  setTag(key: string, value: string): void {
    if (!this.initialized) {
      return;
    }

    try {
      Sentry.withScope((scope) => {
        scope.setTag(key, value);
      });
    } catch (error) {
      logger.error('Failed to set Sentry tag:', error);
    }
  }

  /**
   * Set extra data
   */
  setExtra(key: string, extra: any): void {
    if (!this.initialized) {
      return;
    }

    try {
      Sentry.withScope((scope) => {
        scope.setExtra(key, extra);
      });
    } catch (error) {
      logger.error('Failed to set Sentry extra:', error);
    }
  }

  /**
   * Clear scope
   */
  clearScope(): void {
    if (!this.initialized) {
      return;
    }

    try {
      Sentry.withScope((scope) => {
        scope.clear();
      });
    } catch (error) {
      logger.error('Failed to clear Sentry scope:', error);
    }
  }

  /**
   * Start a transaction
   */
  startTransaction(name: string, operation?: string): any {
    if (!this.initialized) {
      return null;
    }

    try {
      return Sentry.startSpan({
        name,
        op: operation || 'custom'
      }, () => {});
    } catch (error) {
      logger.error('Failed to start Sentry transaction:', error);
      return null;
    }
  }

  /**
   * Capture performance data
   */
  capturePerformance(name: string, operation: string, data?: Record<string, any>): void {
    if (!this.initialized) {
      return;
    }

    try {
      const transaction = this.startTransaction(name, operation);
      if (transaction) {
        if (data) {
          Object.entries(data).forEach(([key, value]) => {
            transaction.setTag(key, value);
          });
        }
        transaction.finish();
      }
    } catch (error) {
      logger.error('Failed to capture performance data:', error);
    }
  }

  /**
   * Capture custom event
   */
  captureEvent(event: {
    message?: string;
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
    tags?: Record<string, string>;
    contexts?: Record<string, any>;
    extra?: Record<string, any>;
    fingerprint?: string[];
  }): string | undefined {
    if (!this.initialized) {
      return undefined;
    }

    try {
      return Sentry.captureEvent(event);
    } catch (error) {
      logger.error('Failed to capture custom event:', error);
      return undefined;
    }
  }

  /**
   * Check if Sentry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get Sentry hub
   */
  getHub(): any {
    if (!this.initialized) {
      return null;
    }

    return Sentry.getClient();
  }

  /**
   * Flush all pending events
   */
  async flush(timeout: number = 2000): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    try {
      return await Sentry.flush(timeout);
    } catch (error) {
      logger.error('Failed to flush Sentry events:', error);
      return false;
    }
  }

  /**
   * Close Sentry client
   */
  async close(timeout: number = 2000): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    try {
      const result = await Sentry.close(timeout);
      this.initialized = false;
      return result;
    } catch (error) {
      logger.error('Failed to close Sentry client:', error);
      return false;
    }
  }

  /**
   * Capture execution context error
   */
  captureExecutionError(error: Error, context: {
    taskId?: string;
    taskTitle?: string;
    executorType?: string;
    projectPath?: string;
  }): string | undefined {
    return this.captureException(error, {
      execution: {
        task_id: context.taskId,
        task_title: context.taskTitle,
        executor_type: context.executorType,
        project_path: context.projectPath
      }
    });
  }

  /**
   * Capture API error
   */
  captureApiError(error: Error, context: {
    method?: string;
    path?: string;
    statusCode?: number;
    userId?: string;
  }): string | undefined {
    return this.captureException(error, {
      api: {
        method: context.method,
        path: context.path,
        status_code: context.statusCode,
        user_id: context.userId
      }
    });
  }

  /**
   * Capture database error
   */
  captureDatabaseError(error: Error, context: {
    query?: string;
    table?: string;
    operation?: string;
  }): string | undefined {
    return this.captureException(error, {
      database: {
        query: context.query,
        table: context.table,
        operation: context.operation
      }
    });
  }

  /**
   * Get service statistics
   */
  getStats(): {
    initialized: boolean;
    environment: string;
    release: string;
  } {
    return {
      initialized: this.initialized,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.npm_package_version || 'unknown'
    };
  }

  /**
   * Test Sentry integration
   */
  testSentry(): void {
    if (!this.initialized) {
      logger.warn('Sentry not initialized, cannot test');
      return;
    }

    try {
      this.captureMessage('Sentry test message', 'info', {
        test: {
          timestamp: new Date().toISOString(),
          service: 'vibe-kanban-backend'
        }
      });

      logger.info('Sentry test message sent');
    } catch (error) {
      logger.error('Failed to send Sentry test message:', error);
    }
  }
}

// Global Sentry service instance
let globalSentryService: SentryService | null = null;

export function getGlobalSentryService(): SentryService {
  if (!globalSentryService) {
    globalSentryService = new SentryService();
  }
  return globalSentryService;
}
