import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export class GitCliError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'GitCliError';
  }
}

export enum ChangeType {
  ADDED = 'A',
  MODIFIED = 'M',
  DELETED = 'D',
  RENAMED = 'R',
  COPIED = 'C',
  TYPE_CHANGED = 'T',
  UNMERGED = 'U',
  UNKNOWN = '?'
}

export interface StatusDiffEntry {
  change: ChangeType;
  path: string;
  old_path?: string;
}

export interface StatusDiffOptions {
  path_filter?: string[];
}

export class GitCli {
  constructor() {}

  /**
   * Ensure git is available
   */
  async ensureAvailable(): Promise<void> {
    try {
      await execAsync('git --version');
    } catch (error) {
      throw new GitCliError('Git executable not found or not runnable', 'GIT_NOT_AVAILABLE');
    }
  }

  /**
   * Add a worktree
   */
  async worktreeAdd(
    repoPath: string,
    worktreePath: string,
    branch: string,
    createBranch: boolean = false
  ): Promise<void> {
    await this.ensureAvailable();

    try {
      let command = `git -C "${repoPath}" worktree add`;
      
      if (createBranch) {
        command += ` -b ${branch}`;
      }
      
      command += ` "${worktreePath}" ${branch}`;

      await execAsync(command);

      // Reapply sparse-checkout in the new worktree (non-fatal if fails)
      try {
        await execAsync(`git -C "${worktreePath}" sparse-checkout reapply`);
      } catch {
        // Ignore errors for sparse-checkout reapply
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to add worktree: ${errorMsg}`, 'WORKTREE_ADD_FAILED');
    }
  }

  /**
   * Remove a worktree
   */
  async worktreeRemove(repoPath: string, worktreePath: string, force: boolean = false): Promise<void> {
    await this.ensureAvailable();

    try {
      const forceFlag = force ? ' --force' : '';
      await execAsync(`git -C "${repoPath}" worktree remove${forceFlag} "${worktreePath}"`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to remove worktree: ${errorMsg}`, 'WORKTREE_REMOVE_FAILED');
    }
  }

  /**
   * List worktrees
   */
  async worktreeList(repoPath: string): Promise<Array<{ path: string; branch?: string; bare: boolean }>> {
    await this.ensureAvailable();

    try {
      const { stdout } = await execAsync(`git -C "${repoPath}" worktree list --porcelain`);
      const worktrees: Array<{ path: string; branch?: string; bare: boolean }> = [];
      
      let currentWorktree: any = {};
      
      for (const line of stdout.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (currentWorktree.path) {
            worktrees.push(currentWorktree);
          }
          currentWorktree = { path: line.substring('worktree '.length), bare: false };
        } else if (line.startsWith('branch ')) {
          currentWorktree.branch = line.substring('branch '.length);
        } else if (line === 'bare') {
          currentWorktree.bare = true;
        } else if (line === '' && currentWorktree.path) {
          worktrees.push(currentWorktree);
          currentWorktree = {};
        }
      }
      
      // Add the last worktree if exists
      if (currentWorktree.path) {
        worktrees.push(currentWorktree);
      }
      
      return worktrees;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to list worktrees: ${errorMsg}`, 'WORKTREE_LIST_FAILED');
    }
  }

  /**
   * Get status diff (name-status)
   */
  async statusDiff(
    repoPath: string,
    fromRef?: string,
    toRef?: string,
    options?: StatusDiffOptions
  ): Promise<StatusDiffEntry[]> {
    await this.ensureAvailable();

    try {
      let command = `git -C "${repoPath}" diff --name-status`;
      
      if (fromRef && toRef) {
        command += ` ${fromRef}...${toRef}`;
      } else if (fromRef) {
        command += ` ${fromRef}`;
      }

      if (options?.path_filter && options.path_filter.length > 0) {
        command += ` -- ${options.path_filter.join(' ')}`;
      }

      const { stdout } = await execAsync(command);
      return this.parseStatusDiffOutput(stdout);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to get status diff: ${errorMsg}`, 'STATUS_DIFF_FAILED');
    }
  }

  /**
   * Parse git diff --name-status output
   */
  private parseStatusDiffOutput(output: string): StatusDiffEntry[] {
    const entries: StatusDiffEntry[] = [];
    
    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;

      const status = parts[0];
      const filePath = parts[1];
      const oldPath = parts[2]; // For renames/copies

      let changeType: ChangeType;
      switch (status[0]) {
        case 'A':
          changeType = ChangeType.ADDED;
          break;
        case 'M':
          changeType = ChangeType.MODIFIED;
          break;
        case 'D':
          changeType = ChangeType.DELETED;
          break;
        case 'R':
          changeType = ChangeType.RENAMED;
          break;
        case 'C':
          changeType = ChangeType.COPIED;
          break;
        case 'T':
          changeType = ChangeType.TYPE_CHANGED;
          break;
        case 'U':
          changeType = ChangeType.UNMERGED;
          break;
        default:
          changeType = ChangeType.UNKNOWN;
      }

      entries.push({
        change: changeType,
        path: filePath,
        old_path: oldPath
      });
    }

    return entries;
  }

  /**
   * Create and switch to a new branch
   */
  async createAndCheckoutBranch(repoPath: string, branchName: string, startPoint?: string): Promise<void> {
    await this.ensureAvailable();

    try {
      const command = startPoint 
        ? `git -C "${repoPath}" checkout -b ${branchName} ${startPoint}`
        : `git -C "${repoPath}" checkout -b ${branchName}`;
      
      await execAsync(command);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to create and checkout branch: ${errorMsg}`, 'CHECKOUT_BRANCH_FAILED');
    }
  }

  /**
   * Add files to staging
   */
  async addFiles(repoPath: string, files: string[] | string = '.'): Promise<void> {
    await this.ensureAvailable();

    try {
      const fileArgs = Array.isArray(files) ? files.map(f => `"${f}"`).join(' ') : files;
      await execAsync(`git -C "${repoPath}" add ${fileArgs}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to add files: ${errorMsg}`, 'ADD_FILES_FAILED');
    }
  }

  /**
   * Commit staged changes
   */
  async commit(repoPath: string, message: string, allowEmpty: boolean = false): Promise<void> {
    await this.ensureAvailable();

    try {
      const emptyFlag = allowEmpty ? ' --allow-empty' : '';
      await execAsync(`git -C "${repoPath}" commit${emptyFlag} -m "${message}"`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to commit: ${errorMsg}`, 'COMMIT_FAILED');
    }
  }

  /**
   * Push branch to remote
   */
  async push(repoPath: string, remoteName: string = 'origin', branchName?: string, setUpstream: boolean = false): Promise<void> {
    await this.ensureAvailable();

    try {
      let command = `git -C "${repoPath}" push`;
      
      if (setUpstream) {
        command += ' -u';
      }
      
      command += ` ${remoteName}`;
      
      if (branchName) {
        command += ` ${branchName}`;
      }

      await execAsync(command);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to push: ${errorMsg}`, 'PUSH_FAILED');
    }
  }

  /**
   * Cherry-pick a commit
   */
  async cherryPick(repoPath: string, commitSha: string, options?: { noCommit?: boolean; mainline?: number }): Promise<void> {
    await this.ensureAvailable();

    try {
      let command = `git -C "${repoPath}" cherry-pick`;
      
      if (options?.noCommit) {
        command += ' --no-commit';
      }
      
      if (options?.mainline) {
        command += ` --mainline ${options.mainline}`;
      }
      
      command += ` ${commitSha}`;

      await execAsync(command);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new GitCliError(`Failed to cherry-pick: ${errorMsg}`, 'CHERRY_PICK_FAILED');
    }
  }

  /**
   * Get commit information
   */
  async getCommitInfo(repoPath: string, commitSha: string): Promise<{
    sha: string;
    message: string;
    author: string;
    date: Date;
  } | null> {
    await this.ensureAvailable();

    try {
      const { stdout } = await execAsync(
        `git -C "${repoPath}" show --no-patch --format="%H|%s|%an|%ai" ${commitSha}`
      );
      
      const [sha, message, author, dateStr] = stdout.trim().split('|');
      
      return {
        sha,
        message,
        author,
        date: new Date(dateStr)
      };
    } catch (error) {
      return null;
    }
  }
}
