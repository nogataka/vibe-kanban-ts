import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { logger } from '../../../../utils/src/logger';
import { 
  ExecutionProcess, 
  ExecutionProcessStatus, 
  ExecutionProcessRunReason, 
  ExecutorActionField 
} from '../../../../db/src/models/types';
import { ModelFactory } from '../../../../db/src/models';
import { CodingAgent } from '../../../../executors/src/executors/mod';
import {
  ExecutionContext
} from '../../../../db/src/models/types';

export interface LogMessage {
  timestamp: string;
  level: 'info' | 'error' | 'warn' | 'debug';
  message: string;
  source?: 'stdout' | 'stderr' | 'system';
  data?: any;
}

export class ExecutionManager extends EventEmitter {
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private logStreams: Map<string, LogMessage[]> = new Map();
  private runningExecutors: Map<string, CodingAgent> = new Map();
  private models: ModelFactory;

  constructor(models: ModelFactory) {
    super();
    this.models = models;
  }

  async startExecution(executionProcess: ExecutionProcess, workingDirectory: string): Promise<void> {
    try {
      logger.info(`Starting execution process: ${executionProcess.id}`);
      
      this.emit('execution:started', executionProcess.id);
      
      // Initialize log stream
      this.logStreams.set(executionProcess.id, []);
      
      // Add initial log
      await this.addLog(executionProcess.id, 'info', 'Execution process started', 'system');
      
      // Execute based on run reason
      switch (executionProcess.run_reason) {
        case ExecutionProcessRunReason.SETUP_SCRIPT:
          await this.executeScript(executionProcess, workingDirectory, 'setup');
          break;
        case ExecutionProcessRunReason.CLEANUP_SCRIPT:
          await this.executeScript(executionProcess, workingDirectory, 'cleanup');
          break;
        case ExecutionProcessRunReason.CODING_AGENT:
          await this.executeCodingAgent(executionProcess, workingDirectory);
          break;
        case ExecutionProcessRunReason.DEV_SERVER:
          await this.executeDevServer(executionProcess, workingDirectory);
          break;
        default:
          throw new Error(`Unsupported run reason: ${executionProcess.run_reason}`);
      }
      
    } catch (error: any) {
      logger.error(`Failed to start execution process ${executionProcess.id}:`, error);
      await this.addLog(executionProcess.id, 'error', `Execution failed: ${error.message}`, 'system');
      await this.completeExecution(executionProcess.id, ExecutionProcessStatus.FAILED, 1);
    }
  }

  private async executeScript(
    executionProcess: ExecutionProcess, 
    workingDirectory: string, 
    scriptType: 'setup' | 'cleanup'
  ): Promise<void> {
    const action = executionProcess.executor_action as any;
    const script = action.script_content || action.script || '';
    
    if (!script) {
      await this.addLog(executionProcess.id, 'warn', `No ${scriptType} script provided`, 'system');
      await this.completeExecution(executionProcess.id, ExecutionProcessStatus.COMPLETED, 0);
      return;
    }

    await this.addLog(executionProcess.id, 'info', `Executing ${scriptType} script`, 'system');

    // Execute script using shell
    const scriptProcess = spawn('sh', ['-c', script], {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    this.runningProcesses.set(executionProcess.id, scriptProcess);

    // Handle stdout
    scriptProcess.stdout?.on('data', async (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        await this.addLog(executionProcess.id, 'info', message, 'stdout');
      }
    });

    // Handle stderr
    scriptProcess.stderr?.on('data', async (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        await this.addLog(executionProcess.id, 'error', message, 'stderr');
      }
    });

    // Handle process completion
    scriptProcess.on('close', async (code: number | null) => {
      this.runningProcesses.delete(executionProcess.id);
      const status = code === 0 ? ExecutionProcessStatus.COMPLETED : ExecutionProcessStatus.FAILED;
      await this.completeExecution(executionProcess.id, status, code || 1);
    });

    scriptProcess.on('error', async (error: Error) => {
      await this.addLog(executionProcess.id, 'error', `Process error: ${error.message}`, 'system');
      this.runningProcesses.delete(executionProcess.id);
      await this.completeExecution(executionProcess.id, ExecutionProcessStatus.FAILED, 1);
    });
  }

  private async executeCodingAgent(
    executionProcess: ExecutionProcess, 
    workingDirectory: string
  ): Promise<void> {
    const action = executionProcess.executor_action as any;
    
    await this.addLog(executionProcess.id, 'info', 'Starting coding agent execution', 'system');
    
    try {
      // Create coding agent executor
      const executor = new CodingAgent(action.profile || 'CLAUDE_CODE');
      this.runningExecutors.set(executionProcess.id, executor);

      // Set up executor event listeners
      // Set up executor event listeners would go here
      // For now, simplified implementation

      // Execute the coding agent action
      try {
        if (action.type === 'coding_agent_initial') {
          await executor.spawn(workingDirectory, action.prompt);
        } else if (action.type === 'coding_agent_follow_up') {
          await executor.spawnFollowUp(workingDirectory, action.prompt, action.session_id);
        } else {
          throw new Error(`Unsupported coding agent action type: ${action.type}`);
        }
      } catch (error) {
        logger.error('Coding agent execution failed:', error);
        throw error;
      }

      // Clean up
      this.runningExecutors.delete(executionProcess.id);

      // Complete execution
      const status = ExecutionProcessStatus.COMPLETED;
      const exitCode = 0;
      
      await this.completeExecution(executionProcess.id, status, exitCode);

    } catch (error: any) {
      await this.addLog(executionProcess.id, 'error', `Coding agent error: ${error.message}`, 'system');
      this.runningExecutors.delete(executionProcess.id);
      await this.completeExecution(executionProcess.id, ExecutionProcessStatus.FAILED, 1);
    }
  }

  private async executeDevServer(
    executionProcess: ExecutionProcess, 
    workingDirectory: string
  ): Promise<void> {
    const action = executionProcess.executor_action as any;
    const command = action.command || 'npm run dev';
    
    await this.addLog(executionProcess.id, 'info', `Starting dev server: ${command}`, 'system');

    // Execute dev server command
    const devProcess = spawn('sh', ['-c', command], {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    this.runningProcesses.set(executionProcess.id, devProcess);

    // Handle stdout
    devProcess.stdout?.on('data', async (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        await this.addLog(executionProcess.id, 'info', message, 'stdout');
      }
    });

    // Handle stderr
    devProcess.stderr?.on('data', async (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        await this.addLog(executionProcess.id, 'warn', message, 'stderr');
      }
    });

    // Dev servers typically don't exit, so we don't handle close event
    devProcess.on('error', async (error: Error) => {
      await this.addLog(executionProcess.id, 'error', `Dev server error: ${error.message}`, 'system');
      this.runningProcesses.delete(executionProcess.id);
      await this.completeExecution(executionProcess.id, ExecutionProcessStatus.FAILED, 1);
    });
  }

  async stopExecution(executionProcessId: string): Promise<void> {
    // Stop AI executor if running
    const executor = this.runningExecutors.get(executionProcessId);
    if (executor) {
      await this.addLog(executionProcessId, 'info', 'Stopping AI executor', 'system');
      // CodingAgent doesn't have a stop method, just remove from tracking
      this.runningExecutors.delete(executionProcessId);
    }

    // Stop regular process if running
    const process = this.runningProcesses.get(executionProcessId);
    
    if (process) {
      await this.addLog(executionProcessId, 'info', 'Stopping execution process', 'system');
      
      process.kill('SIGTERM');
      
      // Give it 5 seconds to terminate gracefully, then force kill
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 5000);
      
      this.runningProcesses.delete(executionProcessId);
      await this.completeExecution(executionProcessId, ExecutionProcessStatus.KILLED, 143);
    } else {
      // Process not found in running processes, update database status
      await this.models.getExecutionProcessModel().updateCompletion(
        executionProcessId,
        ExecutionProcessStatus.KILLED,
        143
      );
    }
  }

  private async addLog(
    executionProcessId: string,
    level: 'info' | 'error' | 'warn' | 'debug',
    message: string,
    source: 'stdout' | 'stderr' | 'system' = 'system',
    data?: any
  ): Promise<void> {
    const logMessage: LogMessage = {
      timestamp: new Date().toISOString(),
      level,
      message,
      source,
      data
    };

    // Add to in-memory stream
    const logs = this.logStreams.get(executionProcessId) || [];
    logs.push(logMessage);
    this.logStreams.set(executionProcessId, logs);

    // Persist to database (as JSONL)
    const logLine = JSON.stringify(logMessage);
    try {
      await this.models.getExecutionProcessLogModel().appendLogs(executionProcessId, logLine);
    } catch (error) {
      logger.error('Failed to persist log to database:', error);
    }

    // Emit real-time log event
    this.emit('log', executionProcessId, logMessage);
  }

  private async completeExecution(
    executionProcessId: string,
    status: ExecutionProcessStatus,
    exitCode: number
  ): Promise<void> {
    await this.addLog(executionProcessId, 'info', `Execution completed with status: ${status}`, 'system');
    
    // Update database
    await this.models.getExecutionProcessModel().updateCompletion(
      executionProcessId,
      status,
      exitCode
    );

    // Emit completion event
    this.emit('execution:completed', executionProcessId, status, exitCode);
  }

  // Get real-time logs for streaming
  getLogs(executionProcessId: string): LogMessage[] {
    return this.logStreams.get(executionProcessId) || [];
  }

  // Check if execution is running (includes both processes and AI executors)
  isRunning(executionProcessId: string): boolean {
    return this.runningProcesses.has(executionProcessId) || this.runningExecutors.has(executionProcessId);
  }

  // Get all running execution processes (includes both processes and AI executors)
  getRunningProcesses(): string[] {
    const processIds = Array.from(this.runningProcesses.keys());
    const executorIds = Array.from(this.runningExecutors.keys());
    return [...processIds, ...executorIds];
  }

  // Cleanup when shutting down
  async cleanup(): Promise<void> {
    const runningIds = Array.from(this.runningProcesses.keys());
    const executorIds = Array.from(this.runningExecutors.keys());
    
    // Stop all running processes
    for (const id of runningIds) {
      await this.stopExecution(id);
    }
    
    // Stop all running AI executors
    for (const id of executorIds) {
      await this.stopExecution(id);
    }
    
    this.runningProcesses.clear();
    this.runningExecutors.clear();
    this.logStreams.clear();
  }
}
