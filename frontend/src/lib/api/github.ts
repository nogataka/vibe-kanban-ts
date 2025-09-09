// GitHub API client
const API_URL = '/api/github';

class GitHubApi {
  private async request(url: string, options: RequestInit = {}) {
    const response = await fetch(`${API_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // ==================== Issues ====================
  
  async createIssue(projectId: string, data: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    milestone?: number;
  }) {
    const result = await this.request('/issues', {
      method: 'POST',
      body: JSON.stringify({ ...data, project_id: projectId }),
    });
    return result.data;
  }

  async getIssues(projectId: string, filters?: {
    state?: 'open' | 'closed' | 'all';
    labels?: string;
    assignee?: string;
    creator?: string;
    mentioned?: string;
    milestone?: number;
    since?: string;
    sort?: 'created' | 'updated' | 'comments';
    direction?: 'asc' | 'desc';
    page?: number;
    per_page?: number;
  }) {
    const params = new URLSearchParams();
    params.append('project_id', projectId);
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      });
    }
    const queryString = params.toString();
    const url = `/issues?${queryString}`;
    const result = await this.request(url);
    return result.data;
  }

  async getIssue(issueNumber: number) {
    const result = await this.request(`/issues/${issueNumber}`);
    return result.data;
  }

  async updateIssue(issueNumber: number, data: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
    assignees?: string[];
    milestone?: number | null;
  }) {
    const result = await this.request(`/issues/${issueNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return result.data;
  }

  async addIssueComment(issueNumber: number, body: string) {
    const result = await this.request(`/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    return result.data;
  }

  async getIssueComments(issueNumber: number) {
    const result = await this.request(`/issues/${issueNumber}/comments`);
    return result.data;
  }

  // ==================== Pull Request Reviews ====================
  
  async createPRReview(pullNumber: number, data: {
    body?: string;
    event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
    comments?: Array<{
      path?: string;
      position?: number;
      line?: number;
      side?: 'LEFT' | 'RIGHT';
      start_line?: number;
      start_side?: 'LEFT' | 'RIGHT';
      body: string;
    }>;
  }) {
    const result = await this.request(`/pulls/${pullNumber}/reviews`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return result.data;
  }

  async getPRReviews(pullNumber: number) {
    const result = await this.request(`/pulls/${pullNumber}/reviews`);
    return result.data;
  }

  async submitPRReview(pullNumber: number, reviewId: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES') {
    const result = await this.request(`/pulls/${pullNumber}/reviews/${reviewId}/events`, {
      method: 'PUT',
      body: JSON.stringify({ event }),
    });
    return result.data;
  }

  async addReviewComment(pullNumber: number, reviewId: number, body: string) {
    const result = await this.request(`/pulls/${pullNumber}/reviews/${reviewId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    return result.data;
  }

  async getPRComments(pullNumber: number) {
    const result = await this.request(`/pulls/${pullNumber}/comments`);
    return result.data;
  }

  async replyToComment(pullNumber: number, commentId: number, body: string) {
    const result = await this.request(`/pulls/${pullNumber}/comments/${commentId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    return result.data;
  }

  // ==================== Pull Requests ====================
  
  async getPullRequests(projectId: string, filters?: {
    state?: 'open' | 'closed' | 'all';
    head?: string;
    base?: string;
    sort?: 'created' | 'updated' | 'popularity' | 'long-running';
    direction?: 'asc' | 'desc';
    page?: number;
    per_page?: number;
  }) {
    const params = new URLSearchParams();
    params.append('project_id', projectId);
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      });
    }
    const queryString = params.toString();
    const url = `/pulls?${queryString}`;
    const result = await this.request(url);
    return result.data;
  }

  // ==================== Merge Operations ====================
  
  async mergePullRequest(pullNumber: number, options?: {
    commit_title?: string;
    commit_message?: string;
    merge_method?: 'merge' | 'squash' | 'rebase';
    sha?: string;
  }) {
    const result = await this.request(`/pulls/${pullNumber}/merge`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
    return result.data;
  }

  async checkMergeability(pullNumber: number) {
    const result = await this.request(`/pulls/${pullNumber}/merge`);
    return result.data;
  }

  async updatePullRequestBranch(pullNumber: number) {
    const result = await this.request(`/pulls/${pullNumber}/update-branch`, {
      method: 'PUT',
    });
    return result;
  }

  async closePullRequest(pullNumber: number) {
    const result = await this.request(`/pulls/${pullNumber}`, {
      method: 'DELETE',
    });
    return result;
  }

  // ==================== Status ====================
  
  async getStatus() {
    const result = await this.request('/status');
    return result.data;
  }
}

export const githubApi = new GitHubApi();