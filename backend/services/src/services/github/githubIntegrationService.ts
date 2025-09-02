import { GitHubApiService, GitHubUserInfo } from './githubApiService';
import { logger } from '../../../../utils/src/logger';
import { ModelFactory } from '../../../../db/src/models';
import { PRStatus } from '../../../../db/src/models/types';
import simpleGit, { SimpleGit } from 'simple-git';

export type { GitHubUserInfo } from './githubApiService';

export interface CreatePROptions {
  title: string;
  body?: string;
  head: string; // branch name
  base: string; // target branch, usually 'main' or 'master'
  draft?: boolean;
}

export interface PRInfo {
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  merged_at?: string;
  merge_commit_sha?: string;
}

export class GitHubIntegrationService {
  private apiService?: GitHubApiService;
  private models: ModelFactory;
  private git: SimpleGit;

  constructor(models: ModelFactory, repoPath?: string) {
    this.models = models;
    this.git = simpleGit(repoPath || process.cwd());
  }

  async initialize(token?: string): Promise<void> {
    if (token) {
      this.apiService = new GitHubApiService(token);
      
      try {
        // Test the token
        const isValid = await this.apiService.checkToken();
        if (!isValid) {
          throw new Error('Invalid GitHub token');
        }
        
        logger.info('GitHub integration initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize GitHub integration:', error);
        this.apiService = undefined;
        throw error;
      }
    } else {
      logger.warn('No GitHub token provided, GitHub features will be disabled');
    }
  }

  async getUserInfo(): Promise<GitHubUserInfo | null> {
    if (!this.apiService) {
      return null;
    }

    try {
      return await this.apiService.getUserInfo();
    } catch (error) {
      logger.error('Failed to get GitHub user info:', error);
      return null;
    }
  }

  async createPullRequest(
    taskAttemptId: string,
    options: CreatePROptions
  ): Promise<PRInfo> {
    if (!this.apiService) {
      throw new Error('GitHub integration not initialized');
    }

    try {
      // Get repository info from git remote
      const remotes = await this.git.getRemotes(true);
      const originRemote = remotes.find(r => r.name === 'origin');
      
      if (!originRemote) {
        throw new Error('No origin remote found');
      }

      // Extract owner/repo from remote URL
      const repoInfo = this.parseGitHubUrl(originRemote.refs.fetch);
      if (!repoInfo) {
        throw new Error('Could not parse GitHub repository URL');
      }

      // Create PR via GitHub API
      const response = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${(this.apiService as any).token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'vibe-kanban'
        },
        body: JSON.stringify({
          title: options.title,
          body: options.body || '',
          head: options.head,
          base: options.base,
          draft: options.draft || false
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub API error: ${response.status} - ${error}`);
      }

      const prData = await response.json() as any;

      const prInfo: PRInfo = {
        number: prData.number,
        url: prData.html_url,
        state: prData.state,
        merged: prData.merged || false,
        merged_at: prData.merged_at,
        merge_commit_sha: prData.merge_commit_sha
      };

      // Create merge record in database
      await this.models.getMergeModel().createPRMerge(
        taskAttemptId,
        prInfo.number,
        prInfo.url,
        options.base,
        PRStatus.OPEN
      );

      logger.info(`Created PR #${prInfo.number}: ${prInfo.url}`);
      return prInfo;

    } catch (error) {
      logger.error('Failed to create pull request:', error);
      throw error;
    }
  }

  async getPullRequest(prNumber: number): Promise<PRInfo | null> {
    if (!this.apiService) {
      return null;
    }

    try {
      // Get repository info
      const remotes = await this.git.getRemotes(true);
      const originRemote = remotes.find(r => r.name === 'origin');
      
      if (!originRemote) {
        return null;
      }

      const repoInfo = this.parseGitHubUrl(originRemote.refs.fetch);
      if (!repoInfo) {
        return null;
      }

      const response = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`, {
        headers: {
          'Authorization': `Bearer ${(this.apiService as any).token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'vibe-kanban'
        }
      });

      if (!response.ok) {
        return null;
      }

      const prData = await response.json() as any;

      return {
        number: prData.number,
        url: prData.html_url,
        state: prData.state,
        merged: prData.merged || false,
        merged_at: prData.merged_at,
        merge_commit_sha: prData.merge_commit_sha
      };

    } catch (error) {
      logger.error('Failed to get pull request:', error);
      return null;
    }
  }

  async updatePRStatuses(): Promise<void> {
    if (!this.apiService) {
      return;
    }

    try {
      // Get all open PRs from database
      const openPRs = await this.models.getMergeModel().findOpenPRs();

      for (const merge of openPRs) {
        if (merge.pr_number) {
          const prInfo = await this.getPullRequest(merge.pr_number);
          
          if (prInfo && prInfo.state !== 'open') {
            // Update PR status in database
            const newStatus = prInfo.merged ? PRStatus.MERGED : PRStatus.CLOSED;
            const mergedAt = prInfo.merged_at ? new Date(prInfo.merged_at) : undefined;
            
            await this.models.getMergeModel().updatePRStatus(
              merge.id,
              newStatus,
              mergedAt,
              prInfo.merge_commit_sha
            );

            logger.info(`Updated PR #${merge.pr_number} status to ${newStatus}`);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to update PR statuses:', error);
    }
  }

  // Parse GitHub URL to extract owner/repo
  private parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    try {
      // Handle both HTTPS and SSH URLs
      const patterns = [
        /github\.com[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/,
        /github\.com\/([^\/]+)\/([^\/]+)/
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          return {
            owner: match[1],
            repo: match[2].replace(/\.git$/, '')
          };
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async pushBranch(branch: string, force: boolean = false): Promise<void> {
    try {
      const args = ['origin', branch];
      if (force) {
        args.push('--force');
      }
      args.push('--set-upstream');
      
      await this.git.push(args);
      logger.info(`Pushed branch ${branch} to origin`);
    } catch (error) {
      logger.error(`Failed to push branch ${branch}:`, error);
      throw error;
    }
  }

  async getCurrentBranch(): Promise<string> {
    const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  }

  async createAndSwitchToBranch(branchName: string, baseBranch: string = 'main'): Promise<void> {
    try {
      // Fetch latest changes
      await this.git.fetch();
      
      // Switch to base branch and pull
      await this.git.checkout(baseBranch);
      await this.git.pull('origin', baseBranch);
      
      // Create and switch to new branch
      await this.git.checkoutBranch(branchName, `origin/${baseBranch}`);
      
      logger.info(`Created and switched to branch: ${branchName}`);
    } catch (error) {
      logger.error(`Failed to create branch ${branchName}:`, error);
      throw error;
    }
  }

  async commitChanges(message: string): Promise<string> {
    try {
      await this.git.add('.');
      const commit = await this.git.commit(message);
      
      const commitHash = commit.commit || '';
      logger.info(`Committed changes: ${commitHash}`);
      return commitHash;
    } catch (error) {
      logger.error('Failed to commit changes:', error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return !!this.apiService;
  }
}
