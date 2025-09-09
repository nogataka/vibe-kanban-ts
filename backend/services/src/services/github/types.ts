/**
 * Common type definitions for GitHub integration features
 */

// Existing PR types (keep for compatibility)
export interface CreatePROptions {
  title: string;
  body?: string;
  head: string;
  base: string;
}

export interface PRInfo {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  html_url: string;
  user: string;
  created_at: string;
  updated_at: string;
  merged: boolean;
  mergeable: boolean | null;
  merged_at: string | null;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
}

// New Issue management types
export interface CreateIssueOptions {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: number;
}

export interface UpdateIssueOptions {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  assignees?: string[];
  milestone?: number | null;
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  html_url: string;
  user: string;
  labels: string[];
  assignees: string[];
  milestone: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number;
}

export interface IssueFilters {
  state?: 'open' | 'closed' | 'all';
  labels?: string;
  assignee?: string;
  creator?: string;
  mentioned?: string;
  milestone?: string | number;
  since?: string;
  sort?: 'created' | 'updated' | 'comments';
  direction?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
}

// PR Review types
export interface CreateReviewOptions {
  body?: string;
  event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
  comments?: ReviewComment[];
}

export interface ReviewComment {
  path?: string;
  position?: number;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
  body: string;
}

export interface ReviewInfo {
  id: number;
  user: string;
  body: string;
  state: 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';
  html_url: string;
  pull_request_url: string;
  submitted_at: string | null;
  commit_id: string;
}

// Comment types (for both Issues and PRs)
export interface CommentInfo {
  id: number;
  user: string;
  body: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  author_association: string;
  reactions?: {
    '+1': number;
    '-1': number;
    laugh: number;
    hooray: number;
    confused: number;
    heart: number;
    rocket: number;
    eyes: number;
  };
}

export interface CreateCommentOptions {
  body: string;
  in_reply_to?: number;
}

// Merge types
export interface MergeOptions {
  commit_title?: string;
  commit_message?: string;
  merge_method?: 'merge' | 'squash' | 'rebase';
  sha?: string;  // Head commit SHA for safety
}

export interface MergeResult {
  merged: boolean;
  message: string;
  sha: string;
}

export interface MergeabilityStatus {
  mergeable: boolean | null;
  mergeable_state: 'unknown' | 'clean' | 'dirty' | 'unstable' | 'blocked' | 'behind' | 'draft';
  merge_commit_sha: string | null;
  status_checks?: {
    state: 'success' | 'pending' | 'failure' | 'error';
    total_count: number;
    statuses: Array<{
      context: string;
      state: 'success' | 'pending' | 'failure' | 'error';
      description: string;
      target_url: string;
    }>;
  };
}

// Pull Request types
export interface PullRequestInfo {
  number: number;
  id: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  user: string;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  assignees: string[];
  requested_reviewers: string[];
  labels: string[];
  milestone: {
    number: number;
    title: string;
  } | null;
  head: {
    label: string;
    ref: string;
    sha: string;
    user: string;
    repo: string | null;
  };
  base: {
    label: string;
    ref: string;
    sha: string;
    user: string;
    repo: string;
  };
  mergeable: boolean | null;
  mergeable_state: string;
  merged: boolean;
  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface PullRequestFilters {
  state?: 'open' | 'closed' | 'all';
  head?: string;
  base?: string;
  sort?: 'created' | 'updated' | 'popularity' | 'long-running';
  direction?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
}
// User info types
export interface GitHubUserInfo {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
}

// Repository info types
export interface RepositoryInfo {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

// Error types
export interface GitHubAPIError {
  status: number;
  message: string;
  documentation_url?: string;
  errors?: Array<{
    resource: string;
    field: string;
    code: string;
    message?: string;
  }>;
}

// Pagination types
export interface PaginationInfo {
  page: number;
  per_page: number;
  total_count?: number;
  total_pages?: number;
  has_next_page: boolean;
  has_previous_page: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}