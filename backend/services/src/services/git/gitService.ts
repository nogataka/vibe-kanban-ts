import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from '../../../../utils/src/logger';
// File stats types (equivalent to Rust's file ranking functionality)
export type FileStats = Map<string, FileStat>;

export interface FileStat {
  last_index: number;
  commit_count: number;
  last_time: Date;
}

const execAsync = promisify(exec);

export interface GitBranch {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  last_commit_date: Date;
}

export interface HeadInfo {
  branch: string;
  oid: string;
}

export interface GitRepoInfo {
  owner: string;
  name: string;
  url: string;
}

export enum DiffChangeKind {
  ADDED = 'added',
  MODIFIED = 'modified',
  DELETED = 'deleted',
  RENAMED = 'renamed',
  COPIED = 'copied',
  TYPE_CHANGED = 'type_changed',
  UNMERGED = 'unmerged',
  UNKNOWN = 'unknown'
}

export interface FileDiffDetails {
  path: string;
  old_path?: string;
  change_kind: DiffChangeKind;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface Diff {
  files: FileDiffDetails[];
  total_additions: number;
  total_deletions: number;
}

export class GitServiceError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'GitServiceError';
  }
}

export interface DiffTarget {
  type: 'worktree' | 'branch' | 'commit';
  worktree_path?: string;
  repo_path?: string;
  branch_name?: string;
  base_branch?: string;
  commit_sha?: string;
}

export class GitService {
  constructor() {}

  /**
   * Check if git is available
   */
  async ensureGitAvailable(): Promise<void> {
    try {
      await execAsync('git --version');
    } catch (error) {
      throw new GitServiceError('Git is not available or not installed', 'GIT_NOT_AVAILABLE');
    }
  }

  /**
   * Get repository information from remote URL
   */
  async getRepoInfo(repoPath: string): Promise<GitRepoInfo | null> {
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd: repoPath });
      const remoteUrl = stdout.trim();
      
      // Parse GitHub URL (both HTTPS and SSH)
      const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/([^\/]+)\/(.+?)(?:\.git)?$/);
      const sshMatch = remoteUrl.match(/git@github\.com:([^\/]+)\/(.+?)(?:\.git)?$/);
      
      const match = httpsMatch || sshMatch;
      if (match) {
        return {
          owner: match[1],
          name: match[2],
          url: `https://github.com/${match[1]}/${match[2]}`
        };
      }
      
      return null;
    } catch (error) {
      logger.debug(`Failed to get repo info for ${repoPath}:`, error);
      return null;
    }
  }

  /**
   * Get all branches in the repository
   */
  async getAllBranches(repoPath: string): Promise<GitBranch[]> {
    try {
      // Get local branches
      const { stdout: localOutput } = await execAsync(
        'git for-each-ref --format="%(refname:short)|%(HEAD)|local|%(committerdate:iso8601)" refs/heads',
        { cwd: repoPath }
      );

      // Get remote branches
      const { stdout: remoteOutput } = await execAsync(
        'git for-each-ref --format="%(refname:short)|false|remote|%(committerdate:iso8601)" refs/remotes',
        { cwd: repoPath }
      );

      const branches: GitBranch[] = [];

      // Parse local branches
      for (const line of localOutput.split('\n').filter(Boolean)) {
        const [name, head, type, date] = line.split('|');
        branches.push({
          name,
          is_current: head === '*',
          is_remote: false,
          last_commit_date: new Date(date)
        });
      }

      // Parse remote branches
      for (const line of remoteOutput.split('\n').filter(Boolean)) {
        const [name, head, type, date] = line.split('|');
        // Skip origin/HEAD
        if (name.endsWith('/HEAD')) continue;
        
        branches.push({
          name,
          is_current: false,
          is_remote: true,
          last_commit_date: new Date(date)
        });
      }

      return branches;
    } catch (error) {
      throw new GitServiceError(`Failed to get branches: ${error}`, 'GET_BRANCHES_FAILED');
    }
  }

  /**
   * Get HEAD information
   */
  async getHeadInfo(repoPath: string): Promise<HeadInfo | null> {
    try {
      const [{ stdout: branch }, { stdout: oid }] = await Promise.all([
        execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath }),
        execAsync('git rev-parse HEAD', { cwd: repoPath })
      ]);

      return {
        branch: branch.trim(),
        oid: oid.trim()
      };
    } catch (error) {
      logger.debug(`Failed to get head info for ${repoPath}:`, error);
      return null;
    }
  }

  /**
   * Ensure main branch exists
   */
  async ensureMainBranchExists(repoPath: string): Promise<void> {
    try {
      // Check if main branch exists
      await execAsync('git rev-parse --verify main', { cwd: repoPath });
    } catch {
      try {
        // Try to create main branch if it doesn't exist
        await execAsync('git checkout -b main', { cwd: repoPath });
      } catch (error) {
        // If that fails, try to create from master if it exists
        try {
          await execAsync('git checkout -b main master', { cwd: repoPath });
        } catch {
          // Create initial empty commit on main
          await execAsync('git commit --allow-empty -m "Initial commit"', { cwd: repoPath });
        }
      }
    }
  }

  /**
   * Check if repository is clean (no uncommitted changes)
   */
  async isRepoClean(repoPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: repoPath });
      return stdout.trim() === '';
    } catch {
      return false;
    }
  }

  /**
   * Get uncommitted changes description
   */
  async getUncommittedChanges(repoPath: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: repoPath });
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(repoPath: string, branchName: string, startPoint?: string): Promise<void> {
    try {
      const command = startPoint 
        ? `git checkout -b ${branchName} ${startPoint}`
        : `git checkout -b ${branchName}`;
      
      await execAsync(command, { cwd: repoPath });
    } catch (error) {
      throw new GitServiceError(`Failed to create branch ${branchName}: ${error}`, 'CREATE_BRANCH_FAILED');
    }
  }

  /**
   * Checkout a branch
   */
  async checkoutBranch(repoPath: string, branchName: string): Promise<void> {
    try {
      await execAsync(`git checkout ${branchName}`, { cwd: repoPath });
    } catch (error) {
      throw new GitServiceError(`Failed to checkout branch ${branchName}: ${error}`, 'CHECKOUT_FAILED');
    }
  }

  /**
   * Get diff between branches or commits
   */
  async getDiff(target: DiffTarget): Promise<Diff> {
    let command: string;
    let cwd: string;

    switch (target.type) {
      case 'worktree':
        if (!target.worktree_path || !target.branch_name || !target.base_branch) {
          throw new GitServiceError('Missing required parameters for worktree diff', 'INVALID_DIFF_TARGET');
        }
        command = `git diff --numstat ${target.base_branch}...${target.branch_name}`;
        cwd = target.worktree_path;
        break;
      
      case 'branch':
        if (!target.repo_path || !target.branch_name || !target.base_branch) {
          throw new GitServiceError('Missing required parameters for branch diff', 'INVALID_DIFF_TARGET');
        }
        command = `git diff --numstat ${target.base_branch}...${target.branch_name}`;
        cwd = target.repo_path;
        break;
      
      case 'commit':
        if (!target.repo_path || !target.commit_sha) {
          throw new GitServiceError('Missing required parameters for commit diff', 'INVALID_DIFF_TARGET');
        }
        command = `git show --numstat ${target.commit_sha}`;
        cwd = target.repo_path;
        break;
      
      default:
        throw new GitServiceError('Invalid diff target type', 'INVALID_DIFF_TARGET');
    }

    try {
      const { stdout } = await execAsync(command, { cwd });
      return this.parseDiffOutput(stdout);
    } catch (error) {
      throw new GitServiceError(`Failed to get diff: ${error}`, 'GET_DIFF_FAILED');
    }
  }

  /**
   * Parse git diff --numstat output
   */
  private parseDiffOutput(output: string): Diff {
    const files: FileDiffDetails[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const line of output.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const [additionsStr, deletionsStr, filePath] = parts;
        
        // Handle binary files (marked with -)
        const additions = additionsStr === '-' ? 0 : parseInt(additionsStr, 10);
        const deletions = deletionsStr === '-' ? 0 : parseInt(deletionsStr, 10);
        const binary = additionsStr === '-' && deletionsStr === '-';

        totalAdditions += additions;
        totalDeletions += deletions;

        files.push({
          path: filePath,
          change_kind: DiffChangeKind.MODIFIED, // Default, would need name-status for accurate detection
          additions,
          deletions,
          binary
        });
      }
    }

    return {
      files,
      total_additions: totalAdditions,
      total_deletions: totalDeletions
    };
  }

  /**
   * Collect recent file statistics for ranking
   */
  async collectRecentFileStats(repoPath: string, commitLimit: number = 100): Promise<FileStats> {
    const stats: FileStats = new Map();

    try {
      // Get recent commits with file changes
      const { stdout } = await execAsync(
        `git log --name-only --pretty=format:"%H|%ai" -n ${commitLimit}`,
        { cwd: repoPath }
      );

      const lines = stdout.split('\n').filter(Boolean);
      let currentCommitIndex = -1;
      let currentCommitDate: Date | null = null;

      for (const line of lines) {
        if (line.includes('|')) {
          // This is a commit line with hash and date
          currentCommitIndex++;
          const [hash, dateStr] = line.split('|');
          currentCommitDate = new Date(dateStr);
        } else {
          // This is a file path
          const filePath = line.trim();
          if (filePath && currentCommitDate) {
            const existing = stats.get(filePath);
            if (existing) {
              existing.commit_count++;
              // Keep the most recent date and index
              if (currentCommitIndex < existing.last_index) {
                existing.last_index = currentCommitIndex;
                existing.last_time = currentCommitDate;
              }
            } else {
              stats.set(filePath, {
                last_index: currentCommitIndex,
                commit_count: 1,
                last_time: currentCommitDate
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to collect file stats for ${repoPath}:`, error);
    }

    return stats;
  }

  /**
   * Initialize a new Git repository
   */
  async initRepository(repoPath: string): Promise<void> {
    try {
      await execAsync('git init', { cwd: repoPath });
      
      // Create initial commit if needed
      try {
        await execAsync('git status --porcelain', { cwd: repoPath });
        // If repo is empty, create initial commit
        const { stdout } = await execAsync('git log --oneline', { cwd: repoPath });
        if (!stdout.trim()) {
          await execAsync('git commit --allow-empty -m "Initial commit"', { cwd: repoPath });
        }
      } catch {
        // No commits yet, create initial
        await execAsync('git commit --allow-empty -m "Initial commit"', { cwd: repoPath });
      }
    } catch (error) {
      throw new GitServiceError(`Failed to initialize repository: ${error}`, 'INIT_REPO_FAILED');
    }
  }

  /**
   * Add and commit files
   */
  async commitFiles(repoPath: string, message: string, files?: string[]): Promise<void> {
    try {
      if (files && files.length > 0) {
        // Add specific files
        for (const file of files) {
          await execAsync(`git add "${file}"`, { cwd: repoPath });
        }
      } else {
        // Add all files
        await execAsync('git add .', { cwd: repoPath });
      }

      await execAsync(`git commit -m "${message}"`, { cwd: repoPath });
    } catch (error) {
      throw new GitServiceError(`Failed to commit files: ${error}`, 'COMMIT_FAILED');
    }
  }

  /**
   * Push branch to remote
   */
  async pushBranch(repoPath: string, branchName: string, remoteName: string = 'origin'): Promise<void> {
    try {
      await execAsync(`git push -u ${remoteName} ${branchName}`, { cwd: repoPath });
    } catch (error) {
      throw new GitServiceError(`Failed to push branch ${branchName}: ${error}`, 'PUSH_FAILED');
    }
  }

  /**
   * Get default remote name
   */
  async getDefaultRemoteName(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git remote', { cwd: repoPath });
      const remotes = stdout.trim().split('\n').filter(Boolean);
      
      // Prefer 'origin', otherwise use the first remote
      if (remotes.includes('origin')) {
        return 'origin';
      }
      return remotes[0] || 'origin';
    } catch {
      return 'origin';
    }
  }

  /**
   * Fetch from remote
   */
  async fetch(repoPath: string, remoteName?: string): Promise<void> {
    try {
      const remote = remoteName || await this.getDefaultRemoteName(repoPath);
      await execAsync(`git fetch ${remote}`, { cwd: repoPath });
    } catch (error) {
      throw new GitServiceError(`Failed to fetch: ${error}`, 'FETCH_FAILED');
    }
  }

  /**
   * Merge branch
   */
  async mergeBranch(repoPath: string, branchName: string, strategy?: string): Promise<void> {
    try {
      const command = strategy 
        ? `git merge -X ${strategy} ${branchName}`
        : `git merge ${branchName}`;
      
      await execAsync(command, { cwd: repoPath });
    } catch (error) {
      // Check if it's a merge conflict
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('conflict')) {
        throw new GitServiceError(`Merge conflicts in ${branchName}`, 'MERGE_CONFLICTS');
      }
      throw new GitServiceError(`Failed to merge branch ${branchName}: ${error}`, 'MERGE_FAILED');
    }
  }

  /**
   * Check if branches have diverged
   */
  async branchesDiverged(repoPath: string, branch1: string, branch2: string): Promise<boolean> {
    try {
      const { stdout: ahead } = await execAsync(
        `git rev-list --count ${branch1}..${branch2}`,
        { cwd: repoPath }
      );
      const { stdout: behind } = await execAsync(
        `git rev-list --count ${branch2}..${branch1}`,
        { cwd: repoPath }
      );

      return parseInt(ahead.trim()) > 0 && parseInt(behind.trim()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if repository has uncommitted changes
   */
  async hasUncommittedChanges(repoPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: repoPath });
      return stdout.trim().length > 0;
    } catch (error) {
      throw new GitServiceError(`Failed to check status: ${error}`, 'STATUS_FAILED');
    }
  }

  /**
   * Get diff stream between current changes and base branch
   */
  async getDiffStream(repoPath: string, baseBranch: string): Promise<NodeJS.ReadableStream> {
    const { Readable } = require('stream');
    
    try {
      const { stdout } = await execAsync(`git diff ${baseBranch}..HEAD`, { cwd: repoPath });
      
      return new Readable({
        read() {
          this.push(stdout);
          this.push(null); // End of stream
        }
      });
    } catch (error) {
      throw new GitServiceError(`Failed to get diff: ${error}`, 'DIFF_FAILED');
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git branch --show-current', { cwd: repoPath });
      return stdout.trim();
    } catch (error) {
      throw new GitServiceError(`Failed to get current branch: ${error}`, 'BRANCH_FAILED');
    }
  }

  /**
   * Create and checkout new branch (duplicate method - remove)
   */

  /**
   * Commit changes
   */
  async commit(repoPath: string, message: string): Promise<string> {
    try {
      await execAsync('git add .', { cwd: repoPath });
      await execAsync(`git commit -m "${message}"`, { cwd: repoPath });
      
      // Get commit hash
      const { stdout: hash } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
      return hash.trim();
    } catch (error) {
      throw new GitServiceError(`Failed to commit: ${error}`, 'COMMIT_FAILED');
    }
  }
}
