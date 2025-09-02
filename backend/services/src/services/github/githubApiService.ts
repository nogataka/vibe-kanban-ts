import { logger } from '../../../../utils/src/logger';

export interface GitHubUser {
  login: string;
  id: number;
  email?: string;
}

export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export interface GitHubUserInfo {
  username: string;
  primary_email?: string;
  token: string;
}

export class GitHubApiService {
  constructor(private token: string) {}

  async getCurrentUser(): Promise<GitHubUser> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'vibe-kanban'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
    }

    return await response.json() as GitHubUser;
  }

  async getUserEmails(): Promise<GitHubEmail[]> {
    const response = await fetch('https://api.github.com/user/emails', {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'vibe-kanban'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
    }

    return await response.json() as GitHubEmail[];
  }

  async getUserInfo(): Promise<GitHubUserInfo> {
    try {
      // Get user details and emails concurrently
      const [user, emails] = await Promise.all([
        this.getCurrentUser(),
        this.getUserEmails()
      ]);

      // Find primary email
      const primaryEmail = emails
        .find(email => email.primary && email.verified)
        ?.email;

      return {
        username: user.login,
        primary_email: primaryEmail,
        token: this.token
      };
    } catch (error) {
      logger.error('Failed to get GitHub user info:', error);
      throw error;
    }
  }

  async checkToken(): Promise<boolean> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'vibe-kanban'
        }
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
