import { GitHubApiService, GitHubUserInfo } from './githubApiService';
import { logger } from '../../../../utils/src/logger';
import { ModelFactory } from '../../../../db/src/models';
import { PRStatus } from '../../../../db/src/models/types';
import simpleGit, { SimpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
import { 
  IssueInfo, 
  IssueFilters, 
  CreateIssueOptions, 
  UpdateIssueOptions,
  CommentInfo,
  ReviewInfo,
  CreateReviewOptions,
  MergeOptions,
  MergeResult,
  MergeabilityStatus,
  PullRequestInfo,
  PullRequestFilters
} from './types';

export type { GitHubUserInfo } from './githubApiService';
export type { 
  CreateIssueOptions, 
  UpdateIssueOptions, 
  IssueInfo, 
  IssueFilters,
  CommentInfo,
  CreateCommentOptions,
  CreateReviewOptions,
  ReviewInfo,
  ReviewComment,
  MergeOptions,
  MergeResult,
  MergeabilityStatus,
  PullRequestInfo,
  PullRequestFilters
} from './types';

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
  private octokit?: Octokit;
  private owner?: string;
  private repo?: string;

  constructor(models: ModelFactory, repoPath?: string) {
    this.models = models;
    this.git = simpleGit(repoPath || process.cwd());
  }

  async initialize(token?: string, repoPath?: string): Promise<void> {
    if (token) {
      this.apiService = new GitHubApiService(token);
      
      // Initialize Octokit
      this.octokit = new Octokit({
        auth: token,
        userAgent: 'vibe-kanban'
      });
      
      try {
        // Test the token
        const isValid = await this.apiService.checkToken();
        if (!isValid) {
          throw new Error('Invalid GitHub token');
        }
        
        // If repoPath is provided, use it to detect repository
        if (repoPath) {
          const git = simpleGit(repoPath);
          const remotes = await git.getRemotes(true);
          const originRemote = remotes.find(r => r.name === 'origin');
          
          if (originRemote) {
            const repoInfo = this.parseGitHubUrl(originRemote.refs.fetch);
            if (repoInfo) {
              this.owner = repoInfo.owner;
              this.repo = repoInfo.repo;
              logger.info(`GitHub repository identified from path: ${this.owner}/${this.repo}`);
            }
          }
        }
        
        logger.info('GitHub integration initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize GitHub integration:', error);
        this.apiService = undefined;
        this.octokit = undefined;
        this.owner = undefined;
        this.repo = undefined;
        throw error;
      }
    } else {
      logger.warn('No GitHub token provided, GitHub features will be disabled');
    }
  }
  
  // Add method to set repository dynamically
  async setRepository(repoPath: string): Promise<void> {
    if (!this.octokit) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }
    
    try {
      const git = simpleGit(repoPath);
      const remotes = await git.getRemotes(true);
      const originRemote = remotes.find(r => r.name === 'origin');
      
      if (originRemote) {
        const repoInfo = this.parseGitHubUrl(originRemote.refs.fetch);
        if (repoInfo) {
          this.owner = repoInfo.owner;
          this.repo = repoInfo.repo;
          logger.info(`GitHub repository set: ${this.owner}/${this.repo}`);
        } else {
          throw new Error(`Could not parse GitHub URL from remote: ${originRemote.refs.fetch}`);
        }
      } else {
        throw new Error('No origin remote found for the repository');
      }
    } catch (error) {
      logger.error('Failed to set repository:', error);
      throw error;
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
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      // Create PR via Octokit
      const response = await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title: options.title,
        body: options.body || '',
        head: options.head,
        base: options.base,
        draft: options.draft || false
      });

      const prInfo: PRInfo = {
        number: response.data.number,
        url: response.data.html_url,
        state: response.data.state as 'open' | 'closed',
        merged: response.data.merged || false,
        merged_at: response.data.merged_at || undefined,
        merge_commit_sha: response.data.merge_commit_sha || undefined
      };

      logger.info(`Created PR #${prInfo.number}: ${prInfo.url}`);
      return prInfo;

    } catch (error: any) {
      logger.error('Failed to create pull request:', error);
      if (error.status === 404) {
        throw new Error('Repository not found');
      } else if (error.status === 401) {
        throw new Error('Authentication failed');
      } else if (error.status === 422) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }

  async getPullRequest(prNumber: number): Promise<PRInfo | null> {
    if (!this.octokit || !this.owner || !this.repo) {
      return null;
    }

    try {
      const response = await this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber
      });

      return {
        number: response.data.number,
        url: response.data.html_url,
        state: response.data.state as 'open' | 'closed',
        merged: response.data.merged || false,
        merged_at: response.data.merged_at || undefined,
        merge_commit_sha: response.data.merge_commit_sha || undefined
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

  // ==================== Issue Management Methods ====================

  async createIssue(options: CreateIssueOptions): Promise<IssueInfo> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.issues.create({
        owner: this.owner,
        repo: this.repo,
        title: options.title,
        body: options.body,
        labels: options.labels,
        assignees: options.assignees,
        milestone: options.milestone
      });

      return this.formatIssueInfo(response.data);
    } catch (error: any) {
      logger.error('Failed to create issue:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async getIssues(filters: IssueFilters = {}): Promise<IssueInfo[]> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        state: filters.state || 'open',
        labels: filters.labels as any,
        assignee: filters.assignee,
        creator: filters.creator,
        mentioned: filters.mentioned,
        milestone: filters.milestone?.toString(),
        since: filters.since,
        sort: filters.sort,
        direction: filters.direction,
        page: filters.page,
        per_page: filters.per_page || 30
      });

      // Filter out pull requests (GitHub API returns PRs as issues too)
      const issuesOnly = response.data.filter((issue: any) => !issue.pull_request);
      
      return issuesOnly.map(issue => this.formatIssueInfo(issue));
    } catch (error: any) {
      logger.error('Failed to get issues:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async getIssue(issueNumber: number): Promise<IssueInfo | null> {
    if (!this.octokit || !this.owner || !this.repo) {
      return null;
    }

    try {
      const response = await this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      });

      return this.formatIssueInfo(response.data);
    } catch (error) {
      logger.error('Failed to get issue:', error);
      return null;
    }
  }

  async updateIssue(issueNumber: number, options: UpdateIssueOptions): Promise<IssueInfo> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        title: options.title,
        body: options.body,
        state: options.state,
        labels: options.labels,
        assignees: options.assignees,
        milestone: options.milestone
      });

      return this.formatIssueInfo(response.data);
    } catch (error: any) {
      logger.error('Failed to update issue:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async addIssueComment(issueNumber: number, body: string): Promise<CommentInfo> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body
      });

      return this.formatCommentInfo(response.data);
    } catch (error: any) {
      logger.error('Failed to add issue comment:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async getIssueComments(issueNumber: number): Promise<CommentInfo[]> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      });

      return response.data.map(comment => this.formatCommentInfo(comment));
    } catch (error: any) {
      logger.error('Failed to get issue comments:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  // ==================== Helper Methods ====================

  private formatIssueInfo(data: any): IssueInfo {
    return {
      number: data.number,
      title: data.title,
      body: data.body || '',
      state: data.state as 'open' | 'closed',
      html_url: data.html_url,
      user: data.user?.login || 'unknown',
      labels: data.labels?.map((label: any) => 
        typeof label === 'string' ? label : label.name
      ) || [],
      assignees: data.assignees?.map((assignee: any) => assignee.login) || [],
      milestone: data.milestone?.number || null,
      created_at: data.created_at,
      updated_at: data.updated_at,
      closed_at: data.closed_at,
      comments: data.comments || 0
    };
  }

  private formatCommentInfo(data: any): CommentInfo {
    return {
      id: data.id,
      user: data.user?.login || 'unknown',
      body: data.body || '',
      html_url: data.html_url,
      created_at: data.created_at,
      updated_at: data.updated_at,
      author_association: data.author_association,
      reactions: data.reactions
    };
  }

  // ==================== PR Review Methods ====================

  async createPRReview(pullNumber: number, options: CreateReviewOptions): Promise<ReviewInfo> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const reviewData: any = {
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber,
        body: options.body,
        event: options.event
      };

      // Add review comments if provided
      if (options.comments && options.comments.length > 0) {
        reviewData.comments = options.comments.map(comment => ({
          path: comment.path,
          position: comment.position,
          line: comment.line,
          side: comment.side,
          start_line: comment.start_line,
          start_side: comment.start_side,
          body: comment.body
        }));
      }

      const response = await this.octokit.rest.pulls.createReview(reviewData);
      return this.formatReviewInfo(response.data);
    } catch (error: any) {
      logger.error('Failed to create PR review:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async getPRReviews(pullNumber: number): Promise<ReviewInfo[]> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.pulls.listReviews({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber
      });

      return response.data.map(review => this.formatReviewInfo(review));
    } catch (error: any) {
      logger.error('Failed to get PR reviews:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async submitPRReview(pullNumber: number, reviewId: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'): Promise<ReviewInfo> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.pulls.submitReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber,
        review_id: reviewId,
        event
      });

      return this.formatReviewInfo(response.data);
    } catch (error: any) {
      logger.error('Failed to submit PR review:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async addReviewComment(pullNumber: number, reviewId: number, body: string): Promise<CommentInfo> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.pulls.createReviewComment({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber,
        body,
        commit_id: await this.getPRHeadSha(pullNumber),
        path: '', // Required but can be empty for general comments
        position: 1 // Required but will be ignored for general comments
      });

      return this.formatCommentInfo(response.data);
    } catch (error: any) {
      logger.error('Failed to add review comment:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async getPRComments(pullNumber: number): Promise<CommentInfo[]> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.pulls.listReviewComments({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber
      });

      return response.data.map(comment => this.formatCommentInfo(comment));
    } catch (error: any) {
      logger.error('Failed to get PR comments:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async replyToComment(pullNumber: number, commentId: number, body: string): Promise<CommentInfo> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.pulls.createReplyForReviewComment({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber,
        comment_id: commentId,
        body
      });

      return this.formatCommentInfo(response.data);
    } catch (error: any) {
      logger.error('Failed to reply to comment:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  private async getPRHeadSha(pullNumber: number): Promise<string> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    const response = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: pullNumber
    });

    return response.data.head.sha;
  }

  private formatReviewInfo(data: any): ReviewInfo {
    return {
      id: data.id,
      user: data.user?.login || 'unknown',
      body: data.body || '',
      state: data.state as ReviewInfo['state'],
      html_url: data.html_url,
      pull_request_url: data.pull_request_url,
      submitted_at: data.submitted_at,
      commit_id: data.commit_id
    };
  }

  private handleOctokitError(error: any): void {
    if (error.status === 404) {
      throw new Error('Repository or resource not found');
    } else if (error.status === 401) {
      throw new Error('Authentication failed');
    } else if (error.status === 403) {
      throw new Error('Permission denied');
    } else if (error.status === 422) {
      throw new Error(`Validation failed: ${error.message}`);
    }
  }

  // ==================== Merge Methods ====================

  async mergePullRequest(pullNumber: number, options: MergeOptions = {}): Promise<MergeResult> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      // First check if PR is mergeable
      const mergeability = await this.checkMergeability(pullNumber);
      
      if (!mergeability.mergeable) {
        throw new Error(`Pull request #${pullNumber} is not mergeable: ${mergeability.mergeable_state}`);
      }

      // Merge the PR
      const response = await this.octokit.rest.pulls.merge({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber,
        commit_title: options.commit_title || `Merge pull request #${pullNumber}`,
        commit_message: options.commit_message || '',
        merge_method: options.merge_method || 'squash',
        sha: options.sha // Optional head SHA for safety
      });

      return {
        merged: response.data.merged,
        message: response.data.message,
        sha: response.data.sha
      };
    } catch (error: any) {
      logger.error('Failed to merge pull request:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async checkMergeability(pullNumber: number): Promise<MergeabilityStatus> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber
      });

      // Get status checks if available
      let statusChecks = undefined;
      try {
        const checksResponse = await this.octokit.rest.repos.getCombinedStatusForRef({
          owner: this.owner,
          repo: this.repo,
          ref: response.data.head.sha
        });
        
        statusChecks = {
          state: checksResponse.data.state as 'success' | 'pending' | 'failure' | 'error',
          total_count: checksResponse.data.total_count,
          statuses: checksResponse.data.statuses.map(status => ({
            context: status.context,
            state: status.state as 'success' | 'pending' | 'failure' | 'error',
            description: status.description || '',
            target_url: status.target_url || ''
          }))
        };
      } catch (error) {
        // Status checks might not be available
        logger.debug('Could not fetch status checks:', error);
      }

      // Determine mergeable state
      let mergeable_state: MergeabilityStatus['mergeable_state'] = 'unknown';
      
      if (response.data.mergeable === false) {
        mergeable_state = 'dirty';
      } else if (response.data.mergeable === true) {
        if (response.data.draft) {
          mergeable_state = 'draft';
        } else if (statusChecks?.state === 'failure' || statusChecks?.state === 'error') {
          mergeable_state = 'unstable';
        } else if (statusChecks?.state === 'pending') {
          mergeable_state = 'blocked';
        } else {
          mergeable_state = 'clean';
        }
      }

      return {
        mergeable: response.data.mergeable,
        mergeable_state,
        merge_commit_sha: response.data.merge_commit_sha,
        status_checks: statusChecks
      };
    } catch (error: any) {
      logger.error('Failed to check mergeability:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  // ==================== Pull Request List ====================
  
  async getPullRequests(filters?: PullRequestFilters): Promise<PullRequestInfo[]> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      const response = await this.octokit.rest.pulls.list({
        owner: this.owner,
        repo: this.repo,
        state: filters?.state || 'open',
        head: filters?.head,
        base: filters?.base,
        sort: filters?.sort || 'created',
        direction: filters?.direction || 'desc',
        page: filters?.page,
        per_page: filters?.per_page || 30
      });

      return response.data.map(pr => ({
        number: pr.number,
        id: pr.id,
        title: pr.title,
        state: pr.state as 'open' | 'closed',
        draft: pr.draft || false,
        user: pr.user?.login || 'unknown',
        body: pr.body,
        html_url: pr.html_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        closed_at: pr.closed_at,
        merged_at: pr.merged_at,
        merge_commit_sha: pr.merge_commit_sha,
        assignees: pr.assignees?.map(a => a.login) || [],
        requested_reviewers: pr.requested_reviewers?.map((r: any) => 
          typeof r === 'string' ? r : r.login
        ) || [],
        labels: pr.labels?.map((l: any) => 
          typeof l === 'string' ? l : l.name
        ) || [],
        milestone: pr.milestone ? {
          number: pr.milestone.number,
          title: pr.milestone.title
        } : null,
        head: {
          label: pr.head.label || '',
          ref: pr.head.ref,
          sha: pr.head.sha,
          user: pr.head.user?.login || '',
          repo: pr.head.repo?.name || null
        },
        base: {
          label: pr.base.label || '',
          ref: pr.base.ref,
          sha: pr.base.sha,
          user: pr.base.user?.login || '',
          repo: pr.base.repo?.name || ''
        },
        mergeable: null, // Not available in list response
        mergeable_state: 'unknown', // Not available in list response
        merged: false, // Can be derived from merged_at
        comments: 0, // Not available in list response
        review_comments: 0, // Not available in list response
        commits: 0, // Not available in list response
        additions: 0, // Not available in list response
        deletions: 0, // Not available in list response
        changed_files: 0 // Not available in list response
      }));
    } catch (error: any) {
      logger.error('Failed to get pull requests:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async updatePullRequestBranch(pullNumber: number): Promise<void> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      await this.octokit.rest.pulls.updateBranch({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber
      });
      
      logger.info(`Updated pull request #${pullNumber} branch`);
    } catch (error: any) {
      logger.error('Failed to update pull request branch:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  async closePullRequest(pullNumber: number): Promise<void> {
    if (!this.octokit || !this.owner || !this.repo) {
      throw new Error('GitHub integration not initialized. Please configure GitHub token in settings.');
    }

    try {
      await this.octokit.rest.pulls.update({
        owner: this.owner,
        repo: this.repo,
        pull_number: pullNumber,
        state: 'closed'
      });
      
      logger.info(`Closed pull request #${pullNumber}`);
    } catch (error: any) {
      logger.error('Failed to close pull request:', error);
      this.handleOctokitError(error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return !!this.octokit && !!this.owner && !!this.repo;
  }
}
