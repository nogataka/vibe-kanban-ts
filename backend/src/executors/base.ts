import { EventEmitter } from 'events';

export interface ExecutorConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ExecutionContext {
  taskId: string;
  attemptId: string;
  worktreePath: string;
  projectPath: string;
}

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  artifacts?: Array<{
    path: string;
    content: string;
  }>;
}

export abstract class BaseExecutor extends EventEmitter {
  protected config: ExecutorConfig;
  protected name: string;

  constructor(name: string, config: ExecutorConfig = {}) {
    super();
    this.name = name;
    this.config = config;
  }

  abstract execute(
    prompt: string,
    context: ExecutionContext
  ): Promise<ExecutionResult>;

  protected async validateConfig(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error(`API key not configured for ${this.name}`);
    }
  }

  protected emitLog(level: string, message: string, data?: any): void {
    this.emit('log', {
      level,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  protected emitProgress(progress: number, message: string): void {
    this.emit('progress', {
      progress,
      message,
      timestamp: new Date().toISOString()
    });
  }

  getName(): string {
    return this.name;
  }

  getConfig(): ExecutorConfig {
    return this.config;
  }
}