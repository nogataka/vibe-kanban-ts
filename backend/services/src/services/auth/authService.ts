import axios, { AxiosInstance } from 'axios';
import { logger } from '../../../../utils/src/logger';

export interface DeviceFlowStartResponse {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface UserInfo {
  username: string;
  primary_email?: string;
  token: string;
}

export interface GitHubEmailEntry {
  email: string;
  primary: boolean;
}

export interface DeviceCodes {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export class AuthError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class AuthService {
  private clientId: string;
  private deviceCodes: DeviceCodes | null = null;
  private httpClient: AxiosInstance;

  constructor(clientId?: string) {
    this.clientId = clientId || process.env.GITHUB_CLIENT_ID || 'Ov23liTSMmzqiYVfrtmA';
    
    this.httpClient = axios.create({
      baseURL: 'https://github.com',
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'vibe-kanban-backend'
      }
    });
  }

  /**
   * Start the GitHub Device Flow authentication
   */
  async deviceStart(): Promise<DeviceFlowStartResponse> {
    try {
      const response = await this.httpClient.post('/login/device/code', {
        client_id: this.clientId,
        scope: 'user:email repo'
      });

      const deviceCodes: DeviceCodes = response.data;
      this.deviceCodes = deviceCodes;

      logger.info(`GitHub device flow started for user code: ${deviceCodes.user_code}`);

      return {
        user_code: deviceCodes.user_code,
        verification_uri: deviceCodes.verification_uri,
        expires_in: deviceCodes.expires_in,
        interval: deviceCodes.interval
      };

    } catch (error) {
      logger.error('Failed to start GitHub device flow:', error);
      throw new AuthError(`Failed to start device flow: ${error}`, 'DEVICE_START_FAILED');
    }
  }

  /**
   * Poll GitHub to check if the user has authorized the device
   */
  async devicePoll(): Promise<UserInfo> {
    if (!this.deviceCodes) {
      throw new AuthError('Device flow not started', 'DEVICE_FLOW_NOT_STARTED');
    }

    try {
      const response = await this.httpClient.post('/login/oauth/access_token', {
        client_id: this.clientId,
        device_code: this.deviceCodes.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      });

      const tokenData = response.data;

      if (tokenData.error) {
        if (tokenData.error === 'authorization_pending') {
          throw new AuthError('Authorization pending', 'AUTHORIZATION_PENDING');
        } else if (tokenData.error === 'slow_down') {
          throw new AuthError('Polling too frequently', 'SLOW_DOWN');
        } else if (tokenData.error === 'expired_token') {
          throw new AuthError('Device code expired', 'EXPIRED_TOKEN');
        } else if (tokenData.error === 'access_denied') {
          throw new AuthError('User denied access', 'ACCESS_DENIED');
        } else {
          throw new AuthError(`OAuth error: ${tokenData.error}`, 'OAUTH_ERROR');
        }
      }

      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new AuthError('No access token received', 'NO_ACCESS_TOKEN');
      }

      // Get user info using the access token
      const userInfo = await this.getUserInfo(accessToken);
      
      logger.info(`GitHub authentication successful for user: ${userInfo.username}`);
      
      return userInfo;

    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }

      logger.error('Failed to poll GitHub device flow:', error);
      throw new AuthError(`Failed to poll device flow: ${error}`, 'DEVICE_POLL_FAILED');
    }
  }

  /**
   * Get user information using an access token
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    try {
      const githubApi = axios.create({
        baseURL: 'https://api.github.com',
        timeout: 30000,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'vibe-kanban-backend'
        }
      });

      // Get user details
      const userResponse = await githubApi.get('/user');
      const user = userResponse.data;

      // Get user emails
      let primaryEmail: string | undefined;
      try {
        const emailsResponse = await githubApi.get('/user/emails');
        const emails: GitHubEmailEntry[] = emailsResponse.data;
        
        const primaryEmailEntry = emails.find(email => email.primary);
        primaryEmail = primaryEmailEntry?.email;
      } catch (error) {
        logger.warn('Failed to get user emails:', error);
        // Continue without email - not critical
      }

      return {
        username: user.login,
        primary_email: primaryEmail,
        token: accessToken
      };

    } catch (error) {
      logger.error('Failed to get user info:', error);
      throw new AuthError(`Failed to get user info: ${error}`, 'GET_USER_INFO_FAILED');
    }
  }

  /**
   * Validate an access token
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const githubApi = axios.create({
        baseURL: 'https://api.github.com',
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'vibe-kanban-backend'
        }
      });

      const response = await githubApi.get('/user');
      return response.status === 200;

    } catch (error) {
      logger.debug('Token validation failed:', error);
      return false;
    }
  }

  /**
   * Revoke an access token
   */
  async revokeToken(accessToken: string): Promise<void> {
    try {
      await this.httpClient.delete(`/applications/${this.clientId}/token`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        data: {
          access_token: accessToken
        }
      });

      logger.info('Access token revoked successfully');

    } catch (error) {
      logger.error('Failed to revoke token:', error);
      throw new AuthError(`Failed to revoke token: ${error}`, 'REVOKE_TOKEN_FAILED');
    }
  }

  /**
   * Get current device codes
   */
  getCurrentDeviceCodes(): DeviceCodes | null {
    return this.deviceCodes;
  }

  /**
   * Clear stored device codes
   */
  clearDeviceCodes(): void {
    this.deviceCodes = null;
  }

  /**
   * Check if device flow is active
   */
  isDeviceFlowActive(): boolean {
    if (!this.deviceCodes) {
      return false;
    }

    // Check if device codes have expired (add some buffer time)
    const expiryTime = Date.now() - (this.deviceCodes.expires_in * 1000) + 60000; // 1 minute buffer
    return Date.now() < expiryTime;
  }

  /**
   * Get recommended polling interval
   */
  getPollingInterval(): number {
    return this.deviceCodes?.interval || 5; // Default to 5 seconds
  }

  /**
   * Get GitHub repository information using token
   */
  async getRepositoryInfo(accessToken: string, owner: string, repo: string): Promise<any> {
    try {
      const githubApi = axios.create({
        baseURL: 'https://api.github.com',
        timeout: 30000,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'vibe-kanban-backend'
        }
      });

      const response = await githubApi.get(`/repos/${owner}/${repo}`);
      return response.data;

    } catch (error) {
      logger.error(`Failed to get repository info for ${owner}/${repo}:`, error);
      throw new AuthError(`Failed to get repository info: ${error}`, 'GET_REPO_INFO_FAILED');
    }
  }

  /**
   * List user repositories using token
   */
  async listUserRepositories(accessToken: string, options: {
    type?: 'all' | 'owner' | 'member';
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    direction?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
  } = {}): Promise<any[]> {
    try {
      const githubApi = axios.create({
        baseURL: 'https://api.github.com',
        timeout: 30000,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'vibe-kanban-backend'
        }
      });

      const params = {
        type: options.type || 'all',
        sort: options.sort || 'updated',
        direction: options.direction || 'desc',
        per_page: options.per_page || 30,
        page: options.page || 1
      };

      const response = await githubApi.get('/user/repos', { params });
      return response.data;

    } catch (error) {
      logger.error('Failed to list user repositories:', error);
      throw new AuthError(`Failed to list repositories: ${error}`, 'LIST_REPOS_FAILED');
    }
  }

  /**
   * Get authentication service statistics
   */
  getStats(): {
    clientId: string;
    deviceFlowActive: boolean;
    currentDeviceCodes: boolean;
  } {
    return {
      clientId: this.clientId,
      deviceFlowActive: this.isDeviceFlowActive(),
      currentDeviceCodes: this.deviceCodes !== null
    };
  }

  /**
   * Cleanup service resources
   */
  cleanup(): void {
    this.clearDeviceCodes();
  }
}
