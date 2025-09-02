import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../../utils/src/logger';
import { configService } from '../../../services/src/services/config';
import { GitHubApiService } from '../../../services/src/services/github';
import { analyticsService } from '../../../services/src/services/analytics';

// Store the current active session globally (simple approach for single-user dev)
let currentDeviceSession: {
  device_code: string;
  client_id: string;
  expires_at: number;
} | null = null;

const router = Router();

// Rust version equivalent schemas
const DeviceCodeSchema = z.object({
  client_id: z.string().optional(),
  scope: z.string().optional()
});

const AccessTokenSchema = z.object({
  client_id: z.string(),
  device_code: z.string(),
  grant_type: z.literal('urn:ietf:params:oauth:grant-type:device_code')
});

interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface GitHubAccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

enum DevicePollStatus {
  SlowDown = 'SLOW_DOWN',
  AuthorizationPending = 'AUTHORIZATION_PENDING',
  Success = 'SUCCESS'
}

enum CheckTokenResponse {
  Valid = 'VALID',
  Invalid = 'INVALID'
}

// POST /api/auth/github/device/start
// Rust equivalent: device_start
router.post('/github/device/start', async (req: Request, res: Response) => {
  // Use same default as Rust version
  const clientId = process.env.GITHUB_CLIENT_ID || 'Ov23li9bxz3kKfPOIsGm';
  
  try {
    const body = DeviceCodeSchema.parse(req.body);
    const scope = body.scope || 'repo user';

    logger.info(`Starting GitHub device flow with client_id: ${clientId}`);

    const requestBody = {
      client_id: clientId,
      scope
    };

    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'vibe-kanban'
      },
      body: JSON.stringify(requestBody)
    });

    logger.info(`GitHub API response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`GitHub API error: ${response.status} - ${errorText}`);
      throw new Error(`GitHub API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json() as GitHubDeviceCodeResponse;
    
    // Store device code for polling (simple single-session approach)
    currentDeviceSession = {
      device_code: data.device_code,
      client_id: clientId,
      expires_at: Date.now() + (data.expires_in * 1000)
    };
    
    logger.info('GitHub device flow started successfully');
    
    res.json({
      success: true,
      data,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to start device flow:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start device flow',
      success: false
    });
  }
});

// POST /api/auth/github/device/poll
// Rust equivalent: device_poll
router.post('/github/device/poll', async (req: Request, res: Response) => {
  try {
    // Check if there's an active device session
    if (!currentDeviceSession) {
      return res.status(400).json({
        error: 'No active device flow session found',
        success: false
      });
    }

    // Check if expired
    if (Date.now() > currentDeviceSession.expires_at) {
      currentDeviceSession = null;
      return res.status(400).json({
        error: 'expired_token',
        success: false
      });
    }

    const pollBody = {
      client_id: currentDeviceSession.client_id,
      device_code: currentDeviceSession.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code' as const
    };

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'vibe-kanban'
      },
      body: JSON.stringify(pollBody)
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const data = await response.json() as GitHubAccessTokenResponse;
    
    if (data.error) {
      // Handle device flow states
      switch (data.error) {
        case 'slow_down':
          return res.json({
            success: true,
            data: DevicePollStatus.SlowDown,
            error_data: null,
            message: null
          });
        case 'authorization_pending':
          return res.json({
            success: true,
            data: DevicePollStatus.AuthorizationPending,
            error_data: null,
            message: null
          });
        default:
          return res.status(400).json({
            error: data.error_description || data.error,
            success: false
          });
      }
    }

    if (data.access_token) {
      // Clear the session since auth is complete
      currentDeviceSession = null;
      
      // Get comprehensive user info using GitHub API service (like Rust version)
      try {
        const githubApi = new GitHubApiService(data.access_token);
        const userInfo = await githubApi.getUserInfo();
        
        logger.info(`GitHub authentication successful for user: ${userInfo.username}`);
        
        // Save to config file (like Rust version)
        await configService.updateGitHubConfig({
          username: userInfo.username,
          primary_email: userInfo.primary_email,
          oauth_token: userInfo.token,
        });
        
        // Track analytics event (like Rust version)
        const analyticsProps = {
          username: userInfo.username,
          email: userInfo.primary_email,
        };
        
        await analyticsService.identifyUser(userInfo.username, analyticsProps);
        
        logger.info('GitHub authentication completed and config saved');
      } catch (userError) {
        logger.warn('Failed to get user info after successful auth:', userError);
        // Still return success since we got the token, but log the issue
      }

      res.json({
        success: true,
        data: DevicePollStatus.Success,
        error_data: null,
        message: null
      });
    } else {
      res.status(400).json({
        error: 'No access token received',
        success: false
      });
    }
  } catch (error) {
    logger.error('Failed to poll device flow:', error);
    res.status(500).json({
      error: 'Failed to poll device flow',
      success: false
    });
  }
});

// GET /api/auth/github/check
// Rust equivalent: github_check_token
router.get('/github/check', async (req: Request, res: Response) => {
  try {
    // Get GitHub configuration from saved config (like Rust version)
    const config = await configService.getConfig();
    const githubToken = config.github.oauth_token;
    
    if (!githubToken) {
      return res.json({
        success: true,
        data: CheckTokenResponse.Invalid,
        error_data: null,
        message: null
      });
    }

    // Use GitHub API service to check token validity
    const githubApi = new GitHubApiService(githubToken);
    const isValid = await githubApi.checkToken();

    res.json({
      success: true,
      data: isValid ? CheckTokenResponse.Valid : CheckTokenResponse.Invalid,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to check GitHub token:', error);
    res.json({
      success: true,
      data: CheckTokenResponse.Invalid,
      error_data: null,
      message: null
    });
  }
});

// Legacy endpoints (keep for backward compatibility but mark as deprecated)
router.post('/device-code', async (req: Request, res: Response) => {
  logger.warn('DEPRECATED: /device-code endpoint used, please use /github/device/start');
  res.status(301).json({
    error: 'Endpoint moved. Use POST /api/auth/github/device/start instead',
    success: false
  });
});

router.post('/access-token', async (req: Request, res: Response) => {
  logger.warn('DEPRECATED: /access-token endpoint used, please use /github/device/poll');
  // For now, return error suggesting correct endpoint
  res.status(404).json({
    error: 'Endpoint deprecated. Use POST /api/auth/github/device/poll instead',
    success: false
  });
});

router.get('/user', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'No authorization token provided',
        success: false
      });
    }

    const token = authHeader.split(' ')[1];
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const userData = await response.json();
    
    res.json({
      data: userData,
      success: true
    });
  } catch (error) {
    logger.error('Failed to get user info:', error);
    res.status(500).json({
      error: 'Failed to get user info',
      success: false
    });
  }
});

export const authRoutes = router;
