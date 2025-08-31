import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export class WorktreeManager {
  private git: SimpleGit;
  private worktreesDir: string;

  constructor(repoPath?: string) {
    const basePath = repoPath || process.cwd();
    this.git = simpleGit(basePath);
    this.worktreesDir = path.join(basePath, '.vibe-worktrees');
  }

  async createWorktree(branchName?: string): Promise<string> {
    await this.ensureWorktreesDirectory();
    
    const worktreeId = uuidv4().slice(0, 8);
    const worktreePath = path.join(this.worktreesDir, worktreeId);
    const branch = branchName || `vibe-${worktreeId}`;

    try {
      await this.git.raw(['worktree', 'add', '-b', branch, worktreePath]);
      logger.info(`Created worktree at ${worktreePath} with branch ${branch}`);
      return worktreePath;
    } catch (error) {
      logger.error('Failed to create worktree:', error);
      throw error;
    }
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    try {
      await this.git.raw(['worktree', 'remove', '--force', worktreePath]);
      logger.info(`Removed worktree at ${worktreePath}`);
    } catch (error) {
      logger.error(`Failed to remove worktree at ${worktreePath}:`, error);
      
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
        await this.git.raw(['worktree', 'prune']);
      } catch (cleanupError) {
        logger.error('Failed to force cleanup worktree:', cleanupError);
      }
    }
  }

  async listWorktrees(): Promise<string[]> {
    try {
      const result = await this.git.raw(['worktree', 'list', '--porcelain']);
      const worktrees: string[] = [];
      
      for (const line of result.split('\n')) {
        if (line.startsWith('worktree ')) {
          worktrees.push(line.replace('worktree ', ''));
        }
      }
      
      return worktrees;
    } catch (error) {
      logger.error('Failed to list worktrees:', error);
      return [];
    }
  }

  async cleanupOrphanedWorktrees(): Promise<void> {
    try {
      await this.git.raw(['worktree', 'prune']);
      
      const worktrees = await this.listWorktrees();
      const vibeWorktrees = worktrees.filter(w => w.includes('.vibe-worktrees'));
      
      for (const worktreePath of vibeWorktrees) {
        try {
          const exists = await fs.access(worktreePath)
            .then(() => true)
            .catch(() => false);
          
          if (!exists) {
            logger.info(`Removing orphaned worktree reference: ${worktreePath}`);
            await this.git.raw(['worktree', 'prune']);
          }
        } catch (error) {
          logger.error(`Failed to check worktree ${worktreePath}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup orphaned worktrees:', error);
    }
  }

  private async ensureWorktreesDirectory(): Promise<void> {
    await fs.mkdir(this.worktreesDir, { recursive: true });
  }

  async getCurrentBranch(): Promise<string> {
    const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  }

  async getMainBranch(): Promise<string> {
    try {
      await this.git.revparse(['--verify', 'main']);
      return 'main';
    } catch {
      try {
        await this.git.revparse(['--verify', 'master']);
        return 'master';
      } catch {
        return 'main';
      }
    }
  }

  async commitChanges(worktreePath: string, message: string): Promise<string> {
    const worktreeGit = simpleGit(worktreePath);
    
    await worktreeGit.add('.');
    const commit = await worktreeGit.commit(message);
    
    return commit.commit || '';
  }

  async pushBranch(worktreePath: string, branch: string): Promise<void> {
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.push('origin', branch, ['--set-upstream']);
  }
}