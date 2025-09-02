import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/src/logger';

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  locked: boolean;
}

export class WorktreeManager {
  private git: SimpleGit;
  private worktreesDir: string;
  private projectPath: string;

  constructor(repoPath?: string) {
    this.projectPath = repoPath || process.cwd();
    this.git = simpleGit(this.projectPath);
    this.worktreesDir = path.join(this.projectPath, '.vibe-worktrees');
  }

  async createWorktree(branchName?: string, baseBranch: string = 'main'): Promise<{path: string, branch: string}> {
    await this.ensureWorktreesDirectory();
    
    const worktreeId = uuidv4().slice(0, 8);
    const worktreePath = path.join(this.worktreesDir, worktreeId);
    const branch = branchName || `vibe-${worktreeId}`;

    try {
      // Fetch latest changes first
      await this.git.fetch();

      // Check if base branch exists
      try {
        await this.git.raw(['rev-parse', '--verify', `origin/${baseBranch}`]);
      } catch (error) {
        // Try without origin prefix
        try {
          await this.git.raw(['rev-parse', '--verify', baseBranch]);
        } catch (error2) {
          throw new Error(`Base branch '${baseBranch}' not found`);
        }
      }

      // Create worktree with new branch based on the base branch
      await this.git.raw(['worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch}`]);
      
      logger.info(`Created worktree at ${worktreePath} with branch ${branch} based on ${baseBranch}`);
      return { path: worktreePath, branch };
    } catch (error: any) {
      logger.error('Failed to create worktree:', error);
      
      // Cleanup on failure
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      throw error;
    }
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    try {
      // First try to remove via git
      await this.git.raw(['worktree', 'remove', '--force', worktreePath]);
      logger.info(`Removed worktree at ${worktreePath}`);
    } catch (error) {
      logger.error(`Failed to remove worktree at ${worktreePath}:`, error);
      
      try {
        // Force cleanup by removing directory and pruning
        await fs.rm(worktreePath, { recursive: true, force: true });
        await this.git.raw(['worktree', 'prune']);
        logger.info(`Force cleaned worktree at ${worktreePath}`);
      } catch (cleanupError) {
        logger.error('Failed to force cleanup worktree:', cleanupError);
        throw cleanupError;
      }
    }
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const result = await this.git.raw(['worktree', 'list', '--porcelain']);
      const worktrees: WorktreeInfo[] = [];
      
      const entries = result.split('\n\n').filter(entry => entry.trim());
      
      for (const entry of entries) {
        const lines = entry.split('\n');
        let worktreeInfo: Partial<WorktreeInfo> = {};
        
        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            worktreeInfo.path = line.replace('worktree ', '');
          } else if (line.startsWith('branch ')) {
            worktreeInfo.branch = line.replace('branch refs/heads/', '');
          } else if (line.startsWith('HEAD ')) {
            worktreeInfo.commit = line.replace('HEAD ', '');
          } else if (line === 'locked') {
            worktreeInfo.locked = true;
          }
        }
        
        if (worktreeInfo.path) {
          worktrees.push({
            path: worktreeInfo.path,
            branch: worktreeInfo.branch || 'unknown',
            commit: worktreeInfo.commit || 'unknown',
            locked: worktreeInfo.locked || false
          });
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
      // First prune worktrees that git knows are missing
      await this.git.raw(['worktree', 'prune']);
      
      const worktrees = await this.listWorktrees();
      const vibeWorktrees = worktrees.filter(w => w.path.includes('.vibe-worktrees'));
      
      for (const worktree of vibeWorktrees) {
        try {
          const exists = await fs.access(worktree.path)
            .then(() => true)
            .catch(() => false);
          
          if (!exists) {
            logger.info(`Removing orphaned worktree reference: ${worktree.path}`);
            await this.git.raw(['worktree', 'prune']);
          }
        } catch (error) {
          logger.error(`Failed to check worktree ${worktree.path}:`, error);
        }
      }
      
      // Clean up empty worktrees directory if it exists
      try {
        const worktreesDirExists = await fs.access(this.worktreesDir)
          .then(() => true)
          .catch(() => false);
          
        if (worktreesDirExists) {
          const contents = await fs.readdir(this.worktreesDir);
          if (contents.length === 0) {
            await fs.rmdir(this.worktreesDir);
            logger.info('Removed empty worktrees directory');
          }
        }
      } catch (error) {
        // Ignore cleanup errors for the directory
      }
    } catch (error) {
      logger.error('Failed to cleanup orphaned worktrees:', error);
    }
  }

  async getWorktreeInfo(worktreePath: string): Promise<WorktreeInfo | null> {
    const worktrees = await this.listWorktrees();
    return worktrees.find(w => w.path === worktreePath) || null;
  }

  async isWorktreeClean(worktreePath: string): Promise<boolean> {
    try {
      const worktreeGit = simpleGit(worktreePath);
      const status = await worktreeGit.status();
      
      return status.files.length === 0;
    } catch (error) {
      logger.error(`Failed to check worktree status at ${worktreePath}:`, error);
      return false;
    }
  }

  async commitWorktreeChanges(worktreePath: string, message: string): Promise<string> {
    try {
      const worktreeGit = simpleGit(worktreePath);
      
      // Add all changes
      await worktreeGit.add('.');
      
      // Check if there are changes to commit
      const status = await worktreeGit.status();
      if (status.staged.length === 0) {
        logger.info('No changes to commit');
        return '';
      }
      
      // Commit changes
      const commit = await worktreeGit.commit(message);
      const commitHash = commit.commit || '';
      
      logger.info(`Committed changes in worktree ${worktreePath}: ${commitHash}`);
      return commitHash;
    } catch (error) {
      logger.error(`Failed to commit changes in worktree ${worktreePath}:`, error);
      throw error;
    }
  }

  async pushWorktreeBranch(worktreePath: string, branch: string): Promise<void> {
    try {
      const worktreeGit = simpleGit(worktreePath);
      await worktreeGit.push('origin', branch, ['--set-upstream']);
      
      logger.info(`Pushed branch ${branch} from worktree ${worktreePath}`);
    } catch (error) {
      logger.error(`Failed to push branch ${branch} from worktree ${worktreePath}:`, error);
      throw error;
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
      // Try to find the default branch from remote
      const remotes = await this.git.raw(['ls-remote', '--symref', 'origin', 'HEAD']);
      const match = remotes.match(/ref: refs\/heads\/(\w+)/);
      if (match) {
        return match[1];
      }
    } catch (error) {
      // Fallback to checking common branch names
    }

    // Fallback: check if main or master exists
    try {
      await this.git.revparse(['--verify', 'refs/heads/main']);
      return 'main';
    } catch {
      try {
        await this.git.revparse(['--verify', 'refs/heads/master']);
        return 'master';
      } catch {
        // Ultimate fallback
        return 'main';
      }
    }
  }

  // Get the project path this worktree manager is managing
  getProjectPath(): string {
    return this.projectPath;
  }

  // Check if the project is a valid git repository
  async isGitRepository(): Promise<boolean> {
    try {
      await this.git.revparse(['--git-dir']);
      return true;
    } catch (error) {
      return false;
    }
  }
}
