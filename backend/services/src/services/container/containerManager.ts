// Container service - equivalent to Rust's services/src/services/container.rs
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ChildProcess } from 'child_process';
import { logger } from '../../../../utils/src/logger';
import { MsgStore } from '../../../../utils/src/msgStore';
import { 
  TaskAttempt, 
  ExecutionProcess, 
  ExecutionProcessStatus,
  ExecutionProcessRunReason, 
  ExecutionContext,
  Task,
  TaskStatus 
} from '../../../../db/src/models/types';
import { DBService } from '../../../../db/src/dbService';
import { GitService } from '../git/gitService';
import { WorktreeManager } from '../worktree';

export type ContainerRef = string;

export interface ContainerConfig {
  name: string;
  image?: string;
  workingDirectory: string;
  environment?: Record<string, string>;
  volumes?: string[];
  ports?: string[];
  command?: string[];
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  created: Date;
  config: ContainerConfig;
}

export class ContainerError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ContainerError';
  }
}

export abstract class ContainerService extends EventEmitter {
  protected msgStores: Map<string, MsgStore> = new Map();
  protected db: DBService;
  protected git: GitService;

  constructor(db: DBService, git: GitService) {
    super();
    this.db = db;
    this.git = git;
  }

  /**
   * Get message stores map
   */
  getMsgStores(): Map<string, MsgStore> {
    return this.msgStores;
  }

  /**
   * Get database service
   */
  getDB(): DBService {
    return this.db;
  }

  /**
   * Get git service
   */
  getGit(): GitService {
    return this.git;
  }

  /**
   * Convert task attempt to current directory path
   */
  taskAttemptToCurrentDir(taskAttempt: TaskAttempt): string {
    // Use container_ref as the working directory
    return taskAttempt.container_ref || process.cwd();
  }

  /**
   * Create container for task attempt
   */
  abstract create(taskAttempt: TaskAttempt): Promise<ContainerRef>;

  /**
   * Delete container and stop processes
   */
  async delete(taskAttempt: TaskAttempt): Promise<void> {
    await this.tryStop(taskAttempt);
    await this.deleteInner(taskAttempt);
  }

  /**
   * Try to stop all running processes for task attempt
   */
  async tryStop(taskAttempt: TaskAttempt): Promise<void> {
    try {
      const processes = await this.db.getConnection()('execution_processes')
        .where('task_attempt_id', taskAttempt.id)
        .where('status', ExecutionProcessStatus.RUNNING);

      for (const process of processes) {
        logger.debug(
          `Stopping execution process ${process.id} for task attempt ${taskAttempt.id}`
        );
        
        try {
          await this.stopExecution(process);
        } catch (error) {
          logger.debug(
            `Failed to stop execution process ${process.id} for task attempt ${taskAttempt.id}: ${error}`
          );
        }
      }
    } catch (error) {
      logger.warn(`Failed to query execution processes for task attempt ${taskAttempt.id}:`, error);
    }
  }

  /**
   * Internal delete implementation
   */
  protected abstract deleteInner(taskAttempt: TaskAttempt): Promise<void>;

  /**
   * Ensure container exists for task attempt
   */
  abstract ensureContainerExists(taskAttempt: TaskAttempt): Promise<ContainerRef>;

  /**
   * Check if container is clean (no uncommitted changes)
   */
  abstract isContainerClean(taskAttempt: TaskAttempt): Promise<boolean>;

  /**
   * Start execution process in container
   */
  abstract startExecutionInner(
    taskAttempt: TaskAttempt,
    executionProcess: ExecutionProcess,
    executorAction: any
  ): Promise<void>;

  /**
   * Stop execution process
   */
  abstract stopExecution(executionProcess: ExecutionProcess): Promise<void>;

  /**
   * Try to commit changes in container
   */
  abstract tryCommitChanges(ctx: ExecutionContext): Promise<boolean>;

  /**
   * Copy project files to container
   */
  abstract copyProjectFiles(
    sourceDir: string,
    targetDir: string,
    copyFiles: string
  ): Promise<void>;

  /**
   * Get diff stream for task attempt
   */
  abstract getDiff(taskAttempt: TaskAttempt): Promise<NodeJS.ReadableStream>;

  /**
   * Get message store by execution ID
   */
  async getMsgStoreById(uuid: string): Promise<MsgStore | null> {
    return this.msgStores.get(uuid) || null;
  }

  /**
   * Create or get message store for execution
   */
  protected getOrCreateMsgStore(executionId: string): MsgStore {
    let store = this.msgStores.get(executionId);
    if (!store) {
      store = new MsgStore();
      this.msgStores.set(executionId, store);
    }
    return store;
  }

  /**
   * Stream raw logs for execution
   */
  async streamRawLogs(executionId: string): Promise<NodeJS.ReadableStream | null> {
    // First try in-memory store
    const store = await this.getMsgStoreById(executionId);
    if (store) {
      return store.createSSEStream();
    }

    // Fallback: load from DB
    try {
      const logsRecord = await this.db.getConnection()('execution_process_logs')
        .where('execution_process_id', executionId)
        .first();

      if (!logsRecord) {
        return null;
      }

      // Parse logs and create stream
      const messages = JSON.parse(logsRecord.logs || '[]');
      
      const { Readable } = require('stream');
      return new Readable({
        objectMode: true,
        read() {
          for (const msg of messages) {
            this.push(msg);
          }
          this.push(null);
        }
      });
    } catch (error) {
      logger.error(`Failed to fetch logs for execution ${executionId}:`, error);
      return null;
    }
  }

  /**
   * Stream normalized logs for execution (matches Rust stream_normalized_logs)
   */
  async streamNormalizedLogs(executionId: string): Promise<NodeJS.ReadableStream | null> {
    const startTime = Date.now();
    logger.info(`[streamNormalizedLogs] Starting for execution ID: ${executionId}`);
    
    // Import Claude executor for log normalization
    const { ClaudeCode } = require('../../../../executors/src/executors/claude');
    
    // First try in-memory store (existing behavior)
    let store = await this.getMsgStoreById(executionId);
    logger.info(`[streamNormalizedLogs] MsgStore from memory: ${store ? 'found' : 'not found'}`);
    
    let alreadyNormalized = false;
    
    if (!store) {
      // Fallback: load from DB and create temporary store
      logger.info(`[streamNormalizedLogs] Trying to load from DB...`);
      try {
        // Convert UUID string to Buffer for database query
        const executionIdBuffer = Buffer.from(executionId.replace(/-/g, ''), 'hex');
        const logsRecord = await this.db.getConnection()('execution_process_logs')
          .where('execution_id', executionIdBuffer)
          .first();
        
        logger.info(`[streamNormalizedLogs] DB logs record: ${logsRecord ? 'found' : 'not found'}`);
        if (logsRecord) {
          logger.info(`[streamNormalizedLogs] Logs length: ${logsRecord.logs?.length || 0} chars`);
        }

        if (!logsRecord) {
          return null;
        }

        // Create temporary store and populate with logs
        store = new MsgStore();
        
        // Parse JSONL format (one JSON per line)
        const lines = (logsRecord.logs || '').split('\n').filter(line => line.trim());
        logger.info(`[streamNormalizedLogs] Parsing ${lines.length} log lines from DB`);
        
        // Check if logs are already normalized (contain JSON_PATCH messages)
        
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            store.push(msg);
            
            // Check if this is a JSON_PATCH message (indicates already normalized)
            if (msg.type === 'json_patch') {
              alreadyNormalized = true;
              logger.info(`[streamNormalizedLogs] Logs are already normalized (found json_patch message)`);
            }
            
            // Also push finished message if found in history
            if (msg.type === 'finished') {
              logger.info(`[streamNormalizedLogs] Found finished message in logs - marking stream as finished`);
              store.pushFinished();
            }
          } catch (e) {
            logger.warn(`[streamNormalizedLogs] Failed to parse log line: ${line.substring(0, 100)}`);
          }
        }
        
        // Don't push finished here as it might already be in the logs
        if (!lines.some(line => {
          try {
            const msg = JSON.parse(line);
            return msg.type === 'finished';
          } catch {
            return false;
          }
        })) {
          store.pushFinished();
        }
      } catch (error) {
        logger.error(`Failed to fetch logs for execution ${executionId}:`, error);
        return null;
      }
    }

    // Helper function to convert Buffer to UUID string
    const bufferToUuid = (buffer: Buffer): string => {
      const hex = buffer.toString('hex');
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32)
      ].join('-');
    };

    // Get execution process details
    const executionIdBuffer = Buffer.from(executionId.replace(/-/g, ''), 'hex');
    const process = await this.db.getConnection()('execution_processes')
      .where('id', executionIdBuffer)
      .first();
    
    if (!process) {
      logger.error(`No execution process found for ID: ${executionId}`);
      return null;
    }

    // Get task attempt for working directory (convert task_attempt_id to UUID string)
    const taskAttemptId = bufferToUuid(process.task_attempt_id);
    const taskAttempt = await this.db.getConnection()('task_attempts')
      .where('id', process.task_attempt_id)
      .first();
    
    if (!taskAttempt) {
      logger.error(`No task attempt found for ID: ${taskAttemptId}`);
      return null;
    }

    // Create modified taskAttempt with string ID for container operations
    const taskAttemptWithStringId = { ...taskAttempt, id: taskAttemptId };

    // For already-normalized logs from DB, we don't need to ensure container exists
    // This significantly improves performance for completed tasks
    // Skip the expensive worktree creation step entirely for completed tasks
    let currentDir: string = this.taskAttemptToCurrentDir(taskAttemptWithStringId);
    
    if (!alreadyNormalized) {
      // Only ensure container exists if we need to normalize logs (active tasks)
      const containerStartTime = Date.now();
      try {
        await this.ensureContainerExists(taskAttemptWithStringId);
        logger.info(`[streamNormalizedLogs] ensureContainerExists took ${Date.now() - containerStartTime}ms`);
      } catch (err) {
        logger.warn(`Failed to recreate worktree before log normalization for task attempt ${taskAttemptId}:`, err);
      }
    } else {
      logger.info(`[streamNormalizedLogs] Skipping ensureContainerExists for already-normalized logs (saves ~1.8s)`);
    }
    
    // Parse executor action
    let executorAction;
    try {
      executorAction = JSON.parse(process.executor_action || '{}');
    } catch (err) {
      logger.error(`Failed to parse executor action:`, err);
      return null;
    }

    // Check both typ.type and type fields for compatibility
    const executorType = executorAction.typ?.type || executorAction.type;
    const executorPrompt = executorAction.typ?.prompt || executorAction.prompt;
    
    logger.info(`[streamNormalizedLogs] executorType = ${executorType}, has prompt = ${!!executorPrompt}`);
    
    // Normalize logs based on executor action type
    if (executorType === 'CodingAgentInitialRequest' || 
        executorType === 'CodingAgentFollowUpRequest' ||
        process.run_reason === 'codingagent') {  // Also check run_reason as a fallback
      
      logger.info(`[streamNormalizedLogs] alreadyNormalized = ${alreadyNormalized}, executorType = ${executorType}`);
      
      // Skip normalization if logs are already normalized (loaded from DB)
      if (alreadyNormalized) {
        logger.info(`[streamNormalizedLogs] Skipping normalization - logs are already normalized`);
        // Don't inject user prompt or normalize - logs are already complete
      } else {
        // Create Claude executor and normalize logs
        const claudeExecutor = ClaudeCode.createDefault();
        
        // Inject initial user prompt before normalization (only for non-normalized logs)
        if (executorPrompt) {
          const userEntry = {
            timestamp: null,
            entry_type: { type: 'user_message' },
            content: executorPrompt,
            metadata: null
          };
          
          store.pushPatch([{
            op: 'add',
            path: '/entries/0',
            value: {
              type: 'NORMALIZED_ENTRY',
              content: userEntry
            }
          }]);
        }
        
        // Normalize the logs
        claudeExecutor.normalizeLogs(store, currentDir);
      }
    } else {
      logger.debug(`Executor action doesn't support log normalization: ${executorType}, run_reason: ${process.run_reason}`);
      return null;
    }

    // Return normalized log stream
    logger.info(`[streamNormalizedLogs] Returning normalized SSE stream, total time: ${Date.now() - startTime}ms`);
    const stream = store.createNormalizedSSEStream();
    logger.info(`[streamNormalizedLogs] Stream created: ${stream ? 'yes' : 'no'}`);
    return stream;
  }

  /**
   * Cleanup all resources
   */
  abstract cleanup(): Promise<void>;
}

export class ContainerManager extends ContainerService {
  private containers: Map<string, ContainerInfo> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private worktreeManager: WorktreeManager;

  constructor(db: DBService, git: GitService, projectPath?: string) {
    super(db, git);
    this.worktreeManager = new WorktreeManager(projectPath);
  }

  async create(taskAttempt: TaskAttempt): Promise<ContainerRef> {
    const containerId = `vibe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info(`Creating container for task attempt: ${taskAttempt.id}`);

    // Create worktree for isolation
    const { path: worktreePath } = await this.worktreeManager.createWorktree(
      `task-${taskAttempt.id}`,
      taskAttempt.base_branch || 'main'
    );

    const containerInfo: ContainerInfo = {
      id: containerId,
      name: `task-${taskAttempt.id}`,
      status: 'running',
      created: new Date(),
      config: {
        name: `task-${taskAttempt.id}`,
        workingDirectory: worktreePath
      }
    };

    this.containers.set(containerId, containerInfo);
    this.emit('container:created', containerId, containerInfo);
    
    return containerId;
  }

  protected async deleteInner(taskAttempt: TaskAttempt): Promise<void> {
    const containerId = taskAttempt.container_ref;
    if (!containerId) return;

    const container = this.containers.get(containerId);
    if (!container) return;

    // Remove worktree
    await this.worktreeManager.removeWorktree(container.config.workingDirectory);
    
    // Remove from tracking
    this.containers.delete(containerId);
    this.emit('container:removed', containerId);
  }

  async ensureContainerExists(taskAttempt: TaskAttempt): Promise<ContainerRef> {
    if (taskAttempt.container_ref) {
      const container = this.containers.get(taskAttempt.container_ref);
      if (container) {
        return taskAttempt.container_ref;
      }
    }
    
    return await this.create(taskAttempt);
  }

  async isContainerClean(taskAttempt: TaskAttempt): Promise<boolean> {
    const containerId = taskAttempt.container_ref;
    if (!containerId) return true;

    const container = this.containers.get(containerId);
    if (!container) return true;

    // Check if worktree has uncommitted changes
    try {
      const hasChanges = await this.git.hasUncommittedChanges(container.config.workingDirectory);
      return !hasChanges;
    } catch {
      return false;
    }
  }

  async startExecutionInner(
    taskAttempt: TaskAttempt,
    executionProcess: ExecutionProcess,
    executorAction: any
  ): Promise<void> {
    const containerId = await this.ensureContainerExists(taskAttempt);
    const container = this.containers.get(containerId);
    
    if (!container) {
      throw new ContainerError(`Container not found: ${containerId}`, 'CONTAINER_NOT_FOUND');
    }

    // Create message store for this execution
    const msgStore = this.getOrCreateMsgStore(executionProcess.id);
    
    // Implementation would depend on executor action type
    logger.info(`Starting execution ${executionProcess.id} in container ${containerId}`);
  }

  async stopExecution(executionProcess: ExecutionProcess): Promise<void> {
    const process = this.processes.get(executionProcess.id);
    if (process && !process.killed) {
      process.kill('SIGTERM');
      
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 5000);
      
      this.processes.delete(executionProcess.id);
    }

    // Update process status in database
    await this.db.getConnection()('execution_processes')
      .where('id', executionProcess.id)
      .update({ 
        status: ExecutionProcessStatus.FAILED,
        updated_at: new Date()
      });
  }

  async tryCommitChanges(ctx: ExecutionContext): Promise<boolean> {
    // This matches Rust's try_commit_changes behavior
    logger.info(`[tryCommitChanges] Called with run_reason: ${ctx.execution_process.run_reason}`);
    logger.info(`[tryCommitChanges] CODING_AGENT value: ${ExecutionProcessRunReason.CODING_AGENT}`);
    logger.info(`[tryCommitChanges] CLEANUP_SCRIPT value: ${ExecutionProcessRunReason.CLEANUP_SCRIPT}`);
    
    // Only commit for CodingAgent and CleanupScript run reasons
    if (ctx.execution_process.run_reason !== ExecutionProcessRunReason.CODING_AGENT && 
        ctx.execution_process.run_reason !== ExecutionProcessRunReason.CLEANUP_SCRIPT) {
      logger.info(`[tryCommitChanges] Skipping commit for run_reason: ${ctx.execution_process.run_reason}`);
      return false;
    }

    try {
      const containerRef = ctx.task_attempt.container_ref;
      if (!containerRef) {
        logger.info('[tryCommitChanges] No container_ref found for task attempt, skipping commit');
        return false;
      }

      // Use container_ref directly as the working directory path
      // (matches Rust's approach where container_ref is the worktree path)
      const workingDir = containerRef;
      const hasChanges = await this.git.hasUncommittedChanges(workingDir);
      
      if (!hasChanges) {
        logger.debug(`No uncommitted changes in ${workingDir}`);
        return false;
      }

      // Create commit message based on run reason
      let message: string;
      if (ctx.execution_process.run_reason === ExecutionProcessRunReason.CODING_AGENT) {
        // Try to get executor session summary
        const executorSession = await this.db.getConnection()('executor_sessions')
          .where('execution_process_id', ctx.execution_process.id)
          .first();
        
        if (executorSession?.summary) {
          message = executorSession.summary;
        } else {
          message = `Commit changes from coding agent for task attempt ${ctx.task_attempt.id}`;
        }
      } else {
        message = `Cleanup script changes for task attempt ${ctx.task_attempt.id}`;
      }

      logger.debug(`Committing changes in ${workingDir}: '${message}'`);

      // Stage all changes and commit
      const { execSync } = require('child_process');
      execSync('git add -A', { cwd: workingDir });
      execSync(`git commit -m "${message.replace(/"/g, '\"')}"`, { cwd: workingDir });
      
      logger.info(`Committed changes for task attempt ${ctx.task_attempt.id}: ${message}`);
      return true;
    } catch (error) {
      logger.error('Failed to commit changes:', error);
      return false;
    }
  }

  async copyProjectFiles(
    sourceDir: string,
    targetDir: string,
    copyFiles: string
  ): Promise<void> {
    const filesToCopy = copyFiles.split(',').map(f => f.trim()).filter(f => f);
    
    for (const filePattern of filesToCopy) {
      const sourcePath = path.resolve(sourceDir, filePattern);
      
      try {
        const stats = await fs.stat(sourcePath);
        
        if (stats.isFile()) {
          const fileName = path.basename(sourcePath);
          const destPath = path.join(targetDir, fileName);
          await fs.copyFile(sourcePath, destPath);
          logger.info(`Copied file: ${sourcePath} -> ${destPath}`);
        } else if (stats.isDirectory()) {
          const dirName = path.basename(sourcePath);
          const destPath = path.join(targetDir, dirName);
          await this.copyDirectoryRecursive(sourcePath, destPath);
          logger.info(`Copied directory: ${sourcePath} -> ${destPath}`);
        }
      } catch (error) {
        logger.warn(`Failed to copy ${filePattern}:`, error);
      }
    }
  }

  async getDiff(taskAttempt: TaskAttempt): Promise<NodeJS.ReadableStream> {
    const containerId = taskAttempt.container_ref;
    if (!containerId) {
      throw new ContainerError('No container reference for task attempt', 'NO_CONTAINER_REF');
    }

    const container = this.containers.get(containerId);
    if (!container) {
      throw new ContainerError(`Container not found: ${containerId}`, 'CONTAINER_NOT_FOUND');
    }

    // Get diff from git service
    const workingDir = container.config.workingDirectory;
    const baseBranch = taskAttempt.base_branch || 'main';
    
    return await this.git.getDiffStream(workingDir, baseBranch);
  }

  private async copyDirectoryRecursive(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up container service...');
    
    // Stop all running processes
    for (const [executionId, process] of this.processes.entries()) {
      if (!process.killed) {
        process.kill('SIGTERM');
      }
    }
    
    this.processes.clear();
    
    // Clear message stores
    this.msgStores.clear();
    
    // Cleanup worktrees
    await this.worktreeManager.cleanupOrphanedWorktrees();
    
    // Clear containers
    this.containers.clear();
    
    logger.info('Container service cleanup completed');
  }

  // Additional methods specific to ContainerManager
  getContainer(containerId: string): ContainerInfo | undefined {
    return this.containers.get(containerId);
  }

  listContainers(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  getRunningContainers(): ContainerInfo[] {
    return Array.from(this.containers.values()).filter(c => c.status === 'running');
  }
}
