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

export enum BranchType {
  LOCAL = 'local',
  REMOTE = 'remote'
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
   * Check if repository has uncommitted changes to tracked files only
   * (Matches Rust's check_worktree_clean behavior)
   */
  async hasTrackedChanges(repoPath: string): Promise<boolean> {
    try {
      logger.debug(`Checking tracked changes in: ${repoPath}`);
      // Rust版のcheck_worktree_cleanと完全に同じ動作をする
      // git status --porcelain=v1 を使用して、未追跡ファイルを除外
      const { stdout } = await execAsync('git status --porcelain=v1 --untracked-files=no --ignored=no', { 
        cwd: repoPath 
      });
      
      logger.debug(`git status output for ${repoPath}:
${stdout}`);
      
      // 出力が空の場合、変更なし
      if (!stdout.trim()) {
        logger.debug(`No tracked changes found in ${repoPath}`);
        return false;
      }
      
      // Rust版と同じフラグをチェック:
      // INDEX_MODIFIED, INDEX_NEW, INDEX_DELETED, INDEX_RENAMED, INDEX_TYPECHANGE
      // WT_MODIFIED, WT_DELETED, WT_RENAMED, WT_TYPECHANGE
      // 
      // git status --porcelain の出力形式:
      // XY filename
      // X = インデックスのステータス
      // Y = ワークツリーのステータス
      const lines = stdout.trim().split('\n');
      const changedFiles = [];
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // ステータスコードとファイル名を取得
        const statusCode = line.substring(0, 2);
        const fileName = line.substring(3).trim();
        
        // Rust版のフラグに対応するステータスコードをチェック
        // M = modified, A = added, D = deleted, R = renamed, T = typechange
        // 第1文字 = インデックス、第2文字 = ワークツリー
        const indexStatus = statusCode[0];
        const wtStatus = statusCode[1];
        
        // インデックスまたはワークツリーに変更がある場合
        if (indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!') {
          // インデックスに変更がある（INDEX_*フラグに相当）
          changedFiles.push(fileName);
          logger.debug(`Found index change: ${statusCode} ${fileName}`);
        } else if (wtStatus !== ' ' && wtStatus !== '?' && wtStatus !== '!') {
          // ワークツリーに変更がある（WT_*フラグに相当）
          changedFiles.push(fileName);
          logger.debug(`Found worktree change: ${statusCode} ${fileName}`);
        }
      }
      
      if (changedFiles.length > 0) {
        logger.error(`DEBUG: Found tracked file changes in ${repoPath}: ${changedFiles.join(', ')}`);
        logger.error(`DEBUG: Full git status output:
${stdout}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.warn('Error checking tracked changes:', error);
      return true; // Assume dirty on error for safety
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

  /**
   * Merge changes from a worktree branch back to the main repository
   * Matches Rust's merge_changes implementation exactly
   */
  async mergeChanges(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    baseBranchName: string,
    commitMessage: string
  ): Promise<string> {
    try {
      // Check if worktree is clean (only tracked files, matching Rust's check_worktree_clean)
      const worktreeHasTrackedChanges = await this.hasTrackedChanges(worktreePath);
      if (worktreeHasTrackedChanges) {
        throw new GitServiceError('Worktree has uncommitted changes', 'WORKTREE_DIRTY');
      }
      
      // Check if main repo is clean (only tracked files)
      const mainRepoHasTrackedChanges = await this.hasTrackedChanges(repoPath);
      if (mainRepoHasTrackedChanges) {
        throw new GitServiceError('Main repository has uncommitted changes', 'REPO_DIRTY');
      }

      // Verify the task branch exists in the worktree
      await execAsync(`git rev-parse --verify ${branchName}`, { cwd: worktreePath });
      
      // Get the base branch from the worktree
      await execAsync(`git rev-parse --verify ${baseBranchName}`, { cwd: worktreePath });

      // Perform a squash merge in the worktree repository
      // We need to work around the fact that the base branch might be checked out in the main repo
      // Use detached HEAD to avoid conflicts with main repo
      const { stdout: baseCommit } = await execAsync(`git rev-parse ${baseBranchName}`, { cwd: worktreePath });
      const baseCommitId = baseCommit.trim();
      
      // Checkout base commit in detached HEAD state to avoid branch conflict
      await execAsync(`git checkout ${baseCommitId}`, { cwd: worktreePath });
      
      // Merge with squash (this stages the changes but doesn't create a commit)
      try {
        await execAsync(`git merge --squash ${branchName}`, { cwd: worktreePath });
      } catch (mergeError: any) {
        // Check if it's a "already up-to-date" situation
        if (mergeError.message?.includes('up-to-date') || mergeError.message?.includes('up to date')) {
          // No changes to merge - this is okay for investigation-only tasks
          logger.info('No changes to merge - branch is up to date');
          // Return the current commit as the "merge" commit
          return baseCommitId;
        }
        // Check for merge conflicts
        if (mergeError.message?.includes('conflict')) {
          throw new GitServiceError('Merge conflicts detected. Please resolve manually.', 'MERGE_CONFLICTS');
        }
        throw mergeError;
      }
      
      // Check if there are staged changes after the merge
      const { stdout: stagedFiles } = await execAsync('git diff --cached --name-only', { cwd: worktreePath });
      if (!stagedFiles.trim()) {
        // No changes staged - already up to date
        logger.info('No changes to commit after merge - already up to date');
        const { stdout: currentCommit } = await execAsync(`git rev-parse HEAD`, { cwd: worktreePath });
        return currentCommit.trim();
      }
      
      // Create the squash commit
      await execAsync(`git commit -m "${commitMessage}"`, { cwd: worktreePath });
      
      // Get the squash commit ID
      const { stdout: squashCommitId } = await execAsync('git rev-parse HEAD', { cwd: worktreePath });
      const squashCommit = squashCommitId.trim();
      
      // Update the base branch reference to point to the new commit (without checking it out)
      // This may fail if the branch is checked out elsewhere, which is ok
      try {
        await execAsync(`git branch -f ${baseBranchName} HEAD`, { cwd: worktreePath });
      } catch (error: any) {
        if (error.message?.includes('cannot force update the branch')) {
          logger.info(`Branch ${baseBranchName} is checked out elsewhere, updating in main repo instead`);
          // Try to update in the main repo if it's safe
          const { stdout: currentBranch } = await execAsync('git symbolic-ref --short HEAD', { 
            cwd: repoPath 
          }).catch(() => ({ stdout: '' }));
          
          if (currentBranch.trim() === baseBranchName) {
            // The base branch is checked out in main repo, we can safely update it
            await execAsync(`git pull`, { cwd: repoPath }).catch(() => {});
            await execAsync(`git fetch ${worktreePath} ${baseBranchName}`, { cwd: repoPath });
            await execAsync(`git merge --ff-only FETCH_HEAD`, { cwd: repoPath });
          } else {
            // Update the branch ref directly without checkout
            await execAsync(`git update-ref refs/heads/${baseBranchName} ${squashCommit}`, { 
              cwd: repoPath 
            });
          }
        } else {
          throw error;
        }
      }

      // Reset the task branch to point to the squash commit
      // This allows follow-up work to continue from the merged state without conflicts
      try {
        await execAsync(`git branch -f ${branchName} HEAD`, { cwd: worktreePath });
      } catch (error) {
        logger.warn('Could not reset task branch, might be checked out:', error);
        // Try alternative approach - checkout and reset
        try {
          await execAsync(`git checkout ${branchName}`, { cwd: worktreePath });
          await execAsync(`git reset --hard ${baseBranchName}`, { cwd: worktreePath });
        } catch (resetError) {
          logger.warn('Could not reset task branch with alternative method:', resetError);
          // Non-fatal - continue
        }
      }

      // Update main repo - use update-ref instead of fetch to avoid checkout conflicts (matches Rust implementation)
      try {
        // Get the latest commit from worktree's base branch
        const { stdout: latestCommit } = await execAsync(`git rev-parse ${baseBranchName}`, { cwd: worktreePath });
        const commitId = latestCommit.trim();
        
        // Update the reference directly in main repo (avoids checkout conflicts)
        await execAsync(`git update-ref refs/heads/${baseBranchName} ${commitId}`, { cwd: repoPath });
        logger.info(`Updated ${baseBranchName} in main repo to ${commitId}`);
      } catch (error) {
        logger.warn('Could not update base branch in main repo:', error);
        // Non-fatal for already up-to-date case
      }

      // Update main repo's HEAD if it's pointing to the base branch
      const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd: repoPath });
      if (currentBranch.trim() === baseBranchName) {
        // Force checkout to update working tree
        try {
          await execAsync(`git checkout -f ${baseBranchName}`, { cwd: repoPath });
        } catch (error) {
          logger.warn('Could not checkout base branch in main repo:', error);
        }
      }

      // Also update the task branch reference in main repo
      try {
        // Get the latest commit from worktree's task branch
        const { stdout: taskCommit } = await execAsync(`git rev-parse ${branchName}`, { cwd: worktreePath });
        const taskCommitId = taskCommit.trim();
        
        // Update the reference directly in main repo (avoids checkout conflicts)
        await execAsync(`git update-ref refs/heads/${branchName} ${taskCommitId}`, { cwd: repoPath });
        logger.info(`Updated ${branchName} in main repo to ${taskCommitId}`);
      } catch (error) {
        logger.warn('Could not update task branch in main repo:', error);
        // Non-fatal
      }

      return squashCommit;
    } catch (error) {
      if (error instanceof GitServiceError) {
        throw error;
      }
      throw new GitServiceError(`Failed to merge changes: ${error}`, 'MERGE_FAILED');
    }
  }

  /**
   * Determine if a branch is local or remote
   */
  async findBranchType(repoPath: string, branchName: string): Promise<BranchType> {
    try {
      // Check if it's a local branch first
      await execAsync(`git show-ref --verify refs/heads/${branchName}`, { cwd: repoPath });
      return BranchType.LOCAL;
    } catch {
      // Try as remote branch
      try {
        await execAsync(`git show-ref --verify refs/remotes/${branchName}`, { cwd: repoPath });
        return BranchType.REMOTE;
      } catch {
        throw new GitServiceError(`Branch not found: ${branchName}`, 'BRANCH_NOT_FOUND');
      }
    }
  }

  /**
   * Get the remote name from a remote branch name (e.g., "origin/main" -> "origin")
   */
  getRemoteNameFromBranchName(branchName: string): string {
    // For remote branches formatted as {remote}/{branch}
    const parts = branchName.split('/');
    if (parts.length >= 2) {
      return parts[0];
    }
    return 'origin'; // Default remote
  }

  /**
   * Rebase a branch onto a new base (matches Rust's rebase_branch)
   */
  async rebaseBranch(
    repoPath: string,
    worktreePath: string,
    newBaseBranch: string | undefined,
    oldBaseBranch: string,
    githubToken?: string
  ): Promise<string> {
    try {
      // Safety guard: never operate on a dirty worktree (matches Rust check_worktree_clean)
      const hasTracked = await this.hasTrackedChanges(worktreePath);
      if (hasTracked) {
        throw new GitServiceError('Worktree has uncommitted changes to tracked files', 'WORKTREE_DIRTY');
      }

      // Check if there's an existing rebase in progress and abort it
      const { stdout: stateOutput } = await execAsync('git status', { cwd: worktreePath }).catch(() => ({ stdout: '' }));
      if (stateOutput.includes('rebase in progress')) {
        logger.warn('Existing rebase in progress, aborting it first');
        await execAsync('git rebase --abort', { cwd: worktreePath }).catch(() => {
          // Ignore error if abort fails
        });
      }

      // Get the target base branch reference
      const newBaseBranchName = newBaseBranch || (await this.getDefaultBranch(repoPath));
      
      // Determine if this is a remote branch
      let newBaseCommitId: string;
      try {
        // Check if it's a remote branch (e.g., origin/main)
        const branchType = await this.findBranchType(repoPath, newBaseBranchName);
        
        if (branchType === BranchType.REMOTE && githubToken) {
          // Fetch the latest changes from remote
          const remoteName = this.getRemoteNameFromBranchName(newBaseBranchName);
          await this.fetchWithAuth(repoPath, githubToken, remoteName);
        }
        
        // Get the commit ID of the new base branch
        const { stdout: commitId } = await execAsync(
          `git rev-parse ${newBaseBranchName}`,
          { cwd: repoPath }
        );
        newBaseCommitId = commitId.trim();
      } catch (error) {
        throw new GitServiceError(`Failed to resolve base branch ${newBaseBranchName}: ${error}`, 'BRANCH_NOT_FOUND');
      }

      // Remember the original task-branch commit before we touch anything
      const { stdout: originalHeadOid } = await execAsync('git rev-parse HEAD', { cwd: worktreePath });
      const originalHead = originalHeadOid.trim();
      
      // Get the HEAD commit of the worktree (the changes to rebase)
      const taskBranchCommitId = originalHead;

      // Get old base commit ID
      const { stdout: oldBaseOid } = await execAsync(
        `git rev-parse ${oldBaseBranch}`,
        { cwd: repoPath }
      );
      const oldBaseCommitId = oldBaseOid.trim();

      // Find commits unique to the task branch (not in either base branch)
      const uniqueCommits = await this.findUniqueCommits(
        worktreePath,
        taskBranchCommitId,
        oldBaseCommitId,
        newBaseCommitId
      );

      // Attempt the rebase operation
      let rebaseResult: string;
      try {
        if (uniqueCommits.length > 0) {
          // Reset HEAD to the new base branch
          await execAsync(`git reset --hard ${newBaseCommitId}`, { cwd: worktreePath });
          
          // Cherry-pick the unique commits
          await this.cherryPickCommits(worktreePath, uniqueCommits);
          
          // Get the final commit after rebase
          const { stdout: finalCommit } = await execAsync('git rev-parse HEAD', { cwd: worktreePath });
          rebaseResult = finalCommit.trim();
        } else {
          // No unique commits to rebase, just reset to new base
          await execAsync(`git reset --hard ${newBaseCommitId}`, { cwd: worktreePath });
          rebaseResult = newBaseCommitId;
        }
      } catch (error) {
        // Handle rebase failure by restoring original state
        logger.error('Rebase failed, restoring original state:', error);
        
        // Clean up any cherry-pick state
        await execAsync('git cherry-pick --abort', { cwd: worktreePath }).catch(() => {
          // Ignore if no cherry-pick in progress
        });
        
        // Restore original task branch state
        await execAsync(`git reset --hard ${originalHead}`, { cwd: worktreePath });
        
        throw error;
      }

      return rebaseResult;
    } catch (error) {
      if (error instanceof GitServiceError) {
        throw error;
      }
      throw new GitServiceError(`Failed to rebase branch: ${error}`, 'REBASE_FAILED');
    }
  }

  /**
   * Get default branch name
   */
  private async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: repoPath });
      return stdout.trim().replace('refs/remotes/origin/', '');
    } catch {
      // Fallback to main or master
      try {
        await execAsync('git show-ref --verify refs/heads/main', { cwd: repoPath });
        return 'main';
      } catch {
        return 'master';
      }
    }
  }

  /**
   * Fetch from remote with authentication
   */
  private async fetchWithAuth(repoPath: string, githubToken: string, remoteName: string): Promise<void> {
    try {
      // Get the remote URL
      const { stdout: remoteUrl } = await execAsync(
        `git remote get-url ${remoteName}`,
        { cwd: repoPath }
      );
      
      // Convert to HTTPS URL with auth
      let httpsUrl = remoteUrl.trim();
      if (httpsUrl.startsWith('git@github.com:')) {
        httpsUrl = httpsUrl.replace('git@github.com:', 'https://github.com/');
      }
      if (!httpsUrl.endsWith('.git')) {
        httpsUrl += '.git';
      }
      
      // Create authenticated URL
      const authUrl = `https://git:${githubToken}@${httpsUrl.replace('https://', '')}`;
      
      // Remove any existing temporary remote
      await execAsync('git remote remove temp-fetch', { cwd: repoPath }).catch(() => {
        // Ignore if it doesn't exist
      });
      
      // Add temporary remote with auth
      await execAsync(`git remote add temp-fetch "${authUrl}"`, { cwd: repoPath });
      
      try {
        // Use git ls-remote to avoid fetch conflicts with checked out branches
        // This approach avoids the "refusing to fetch into branch" error
        logger.info(`Fetching remote references for ${remoteName} without updating local branches`);
        
        // First, update remote tracking branches using refspec that avoids conflicts
        await execAsync(
          `git fetch temp-fetch "+refs/heads/*:refs/remotes/${remoteName}/*"`,
          { cwd: repoPath }
        );
        
        logger.info(`Successfully fetched remote references for ${remoteName}`);
      } finally {
        // Clean up temporary remote
        await execAsync('git remote remove temp-fetch', { cwd: repoPath }).catch(() => {
          // Ignore error
        });
      }
    } catch (error) {
      throw new GitServiceError(`Failed to fetch from remote ${remoteName}: ${error}`, 'FETCH_FAILED');
    }
  }

  /**
   * Find commits unique to the task branch (matches Rust find_unique_commits)
   */
  private async findUniqueCommits(
    repoPath: string,
    taskBranchCommit: string,
    oldBaseCommit: string,
    newBaseCommit: string
  ): Promise<string[]> {
    try {
      // Find merge-base between task branch and old base branch
      const { stdout: taskOldBaseMergeBase } = await execAsync(
        `git merge-base ${taskBranchCommit} ${oldBaseCommit}`,
        { cwd: repoPath }
      );
      const mergeBase = taskOldBaseMergeBase.trim();

      // Get all commits from task branch back to the merge-base with old base
      const { stdout: commitsOutput } = await execAsync(
        `git rev-list --reverse ${mergeBase}..${taskBranchCommit}`,
        { cwd: repoPath }
      );

      const commits = commitsOutput.trim().split('\n').filter(Boolean);
      
      // Filter out any commits that are already in the new base
      const uniqueCommits: string[] = [];
      for (const commitId of commits) {
        try {
          // Check if this commit is already in new base
          await execAsync(
            `git merge-base --is-ancestor ${commitId} ${newBaseCommit}`,
            { cwd: repoPath }
          );
          // If the command succeeds, the commit is already in new base, skip it
        } catch {
          // Command fails if commit is not an ancestor of new base, so we keep it
          uniqueCommits.push(commitId);
        }
      }

      return uniqueCommits;
    } catch (error) {
      throw new GitServiceError(`Failed to find unique commits: ${error}`, 'COMMITS_FAILED');
    }
  }

  /**
   * Cherry-pick specific commits onto current HEAD (matches Rust cherry_pick_commits)
   */
  private async cherryPickCommits(repoPath: string, commits: string[]): Promise<void> {
    for (const commitId of commits) {
      try {
        // Cherry-pick the commit
        await execAsync(`git cherry-pick ${commitId}`, { cwd: repoPath });
      } catch (error: any) {
        // Check for conflicts
        if (error.message?.includes('conflict')) {
          throw new GitServiceError(
            `Cherry-pick failed due to conflicts on commit ${commitId}, please resolve conflicts manually`,
            'MERGE_CONFLICTS'
          );
        }
        throw error;
      }
    }
  }
}
