import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../../utils/src/logger';
import { WorktreeManager } from '../../services/src/services/worktree';
import * as path from 'path';
import * as fs from 'fs/promises';

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

export class ContainerManager extends EventEmitter {
  private containers: Map<string, ContainerInfo> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private worktreeManager: WorktreeManager;

  constructor(projectPath?: string) {
    super();
    this.worktreeManager = new WorktreeManager(projectPath);
  }

  async createContainer(config: ContainerConfig): Promise<string> {
    try {
      const containerId = `vibe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      logger.info(`Creating container: ${config.name}`);

      // For now, we'll use worktrees instead of actual Docker containers
      // This provides isolation while being simpler to manage
      const { path: worktreePath, branch } = await this.worktreeManager.createWorktree(
        `container-${containerId}`,
        'main'
      );

      const containerInfo: ContainerInfo = {
        id: containerId,
        name: config.name,
        status: 'running',
        created: new Date(),
        config: {
          ...config,
          workingDirectory: worktreePath // Update with actual worktree path
        }
      };

      this.containers.set(containerId, containerInfo);
      
      // Copy files to worktree if specified in project config
      if (config.environment?.COPY_FILES) {
        await this.copyFilesToWorktree(worktreePath, config.environment.COPY_FILES);
      }

      this.emit('container:created', containerId, containerInfo);
      logger.info(`Container created: ${containerId} at ${worktreePath}`);
      
      return containerId;
    } catch (error) {
      logger.error('Failed to create container:', error);
      throw error;
    }
  }

  async startContainer(containerId: string): Promise<void> {
    const container = this.containers.get(containerId);
    if (!container) {
      throw new Error(`Container not found: ${containerId}`);
    }

    try {
      logger.info(`Starting container: ${containerId}`);
      
      // Update status
      container.status = 'running';
      this.containers.set(containerId, container);
      
      this.emit('container:started', containerId, container);
      logger.info(`Container started: ${containerId}`);
    } catch (error) {
      container.status = 'error';
      this.containers.set(containerId, container);
      logger.error(`Failed to start container ${containerId}:`, error);
      throw error;
    }
  }

  async stopContainer(containerId: string): Promise<void> {
    const container = this.containers.get(containerId);
    if (!container) {
      throw new Error(`Container not found: ${containerId}`);
    }

    try {
      logger.info(`Stopping container: ${containerId}`);
      
      // Stop any running processes in this container
      const process = this.processes.get(containerId);
      if (process && !process.killed) {
        process.kill('SIGTERM');
        
        // Give it time to terminate gracefully
        setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGKILL');
          }
        }, 5000);
        
        this.processes.delete(containerId);
      }

      // Update status
      container.status = 'stopped';
      this.containers.set(containerId, container);
      
      this.emit('container:stopped', containerId, container);
      logger.info(`Container stopped: ${containerId}`);
    } catch (error) {
      logger.error(`Failed to stop container ${containerId}:`, error);
      throw error;
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    const container = this.containers.get(containerId);
    if (!container) {
      throw new Error(`Container not found: ${containerId}`);
    }

    try {
      // Stop container first if running
      if (container.status === 'running') {
        await this.stopContainer(containerId);
      }

      logger.info(`Removing container: ${containerId}`);
      
      // Remove worktree
      await this.worktreeManager.removeWorktree(container.config.workingDirectory);
      
      // Remove from tracking
      this.containers.delete(containerId);
      
      this.emit('container:removed', containerId);
      logger.info(`Container removed: ${containerId}`);
    } catch (error) {
      logger.error(`Failed to remove container ${containerId}:`, error);
      throw error;
    }
  }

  async executeInContainer(
    containerId: string,
    command: string[],
    options?: {
      detached?: boolean;
      stdio?: 'pipe' | 'inherit';
    }
  ): Promise<ChildProcess> {
    const container = this.containers.get(containerId);
    if (!container) {
      throw new Error(`Container not found: ${containerId}`);
    }

    if (container.status !== 'running') {
      throw new Error(`Container is not running: ${containerId}`);
    }

    try {
      logger.info(`Executing command in container ${containerId}: ${command.join(' ')}`);
      
      const childProcess = spawn(command[0], command.slice(1), {
        cwd: container.config.workingDirectory,
        env: {
          ...process.env,
          ...container.config.environment
        },
        stdio: options?.stdio || 'pipe',
        detached: options?.detached || false
      });

      // Track the process
      this.processes.set(containerId, childProcess);

      // Handle process events
      process.on('exit', (code) => {
        this.processes.delete(containerId);
        this.emit('container:process:exit', containerId, code);
      });

      process.on('error', (error) => {
        this.processes.delete(containerId);
        this.emit('container:process:error', containerId, error);
      });

      return childProcess;
    } catch (error) {
      logger.error(`Failed to execute command in container ${containerId}:`, error);
      throw error;
    }
  }

  getContainer(containerId: string): ContainerInfo | undefined {
    return this.containers.get(containerId);
  }

  listContainers(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  getRunningContainers(): ContainerInfo[] {
    return Array.from(this.containers.values()).filter(c => c.status === 'running');
  }

  async getContainerLogs(containerId: string): Promise<string> {
    const container = this.containers.get(containerId);
    if (!container) {
      throw new Error(`Container not found: ${containerId}`);
    }

    // For worktree-based containers, we could return git logs or other relevant info
    // For now, return a simple status message
    return `Container ${containerId} (${container.name}) - Status: ${container.status}\nCreated: ${container.created.toISOString()}\nWorking Directory: ${container.config.workingDirectory}`;
  }

  async copyFilesToWorktree(worktreePath: string, copyFiles: string): Promise<void> {
    try {
      const filesToCopy = copyFiles.split(',').map(f => f.trim()).filter(f => f);
      
      for (const filePattern of filesToCopy) {
        const sourcePath = path.resolve(filePattern);
        
        try {
          const stats = await fs.stat(sourcePath);
          
          if (stats.isFile()) {
            const fileName = path.basename(sourcePath);
            const destPath = path.join(worktreePath, fileName);
            await fs.copyFile(sourcePath, destPath);
            logger.info(`Copied file: ${sourcePath} -> ${destPath}`);
          } else if (stats.isDirectory()) {
            const dirName = path.basename(sourcePath);
            const destPath = path.join(worktreePath, dirName);
            await this.copyDirectoryRecursive(sourcePath, destPath);
            logger.info(`Copied directory: ${sourcePath} -> ${destPath}`);
          }
        } catch (error) {
          logger.warn(`Failed to copy ${filePattern}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to copy files to worktree:', error);
    }
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
    logger.info('Cleaning up container manager...');
    
    const runningContainers = this.getRunningContainers();
    
    for (const container of runningContainers) {
      try {
        await this.stopContainer(container.id);
      } catch (error) {
        logger.error(`Failed to stop container during cleanup: ${container.id}`, error);
      }
    }

    // Clean up worktrees
    await this.worktreeManager.cleanupOrphanedWorktrees();
    
    this.containers.clear();
    this.processes.clear();
    
    logger.info('Container manager cleanup completed');
  }
}
