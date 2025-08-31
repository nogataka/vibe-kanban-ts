import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';

const router = Router();

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

router.post('/device-code', async (req: Request, res: Response) => {
  try {
    const body = DeviceCodeSchema.parse(req.body);
    const clientId = body.client_id || process.env.GITHUB_CLIENT_ID || 'Ov23liTSMmzqiYVfrtmA';
    const scope = body.scope || 'repo user';

    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        scope
      })
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const data = await response.json() as GitHubDeviceCodeResponse;
    res.json(data);
  } catch (error) {
    logger.error('Failed to get device code:', error);
    res.status(500).json({ error: 'Failed to get device code' });
  }
});

router.post('/access-token', async (req: Request, res: Response) => {
  try {
    const body = AccessTokenSchema.parse(req.body);

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const data = await response.json() as GitHubAccessTokenResponse;
    
    if (data.error) {
      res.status(400).json({
        error: data.error,
        error_description: data.error_description
      });
    } else {
      res.json({
        access_token: data.access_token,
        token_type: data.token_type,
        scope: data.scope
      });
    }
  } catch (error) {
    logger.error('Failed to get access token:', error);
    res.status(500).json({ error: 'Failed to get access token' });
  }
});

router.get('/user', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
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
    return res.json(userData);
  } catch (error) {
    logger.error('Failed to get user info:', error);
    return res.status(500).json({ error: 'Failed to get user info' });
  }
});

export const authRoutes = router;