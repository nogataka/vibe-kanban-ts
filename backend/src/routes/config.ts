import { Router, Request, Response } from 'express';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService } from '../services/database';

const router = Router();

interface SystemConfig {
  version: string;
  platform: string;
  arch: string;
  node_version: string;
  data_dir: string;
  github_client_id: string;
  analytics_enabled: boolean;
  available_executors: string[];
}

router.get('/system', async (req: Request, res: Response) => {
  const packageJson = require('../../package.json');
  
  const config: SystemConfig = {
    version: packageJson.version || '0.0.1',
    platform: os.platform(),
    arch: os.arch(),
    node_version: process.version,
    data_dir: path.join(process.cwd(), 'data'),
    github_client_id: process.env.GITHUB_CLIENT_ID || 'Ov23liTSMmzqiYVfrtmA',
    analytics_enabled: !!process.env.POSTHOG_API_KEY,
    available_executors: [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'gpt-4o',
      'gpt-4o-mini',
      'o1-preview',
      'o1-mini',
      'gemini-1-5-pro-002',
      'gemini-1-5-flash-002',
      'gemini-2-0-flash-exp',
      'deepseek-chat',
      'bedrock-claude-3-5-sonnet-v2',
      'bedrock-claude-3-5-haiku',
      'qwen-coder-plus-latest'
    ]
  };

  res.json(config);
});

router.get('/executors', async (req: Request, res: Response) => {
  const executors = [
    {
      id: 'claude-3-5-sonnet-latest',
      name: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
      requires_api_key: true,
      env_var: 'ANTHROPIC_API_KEY'
    },
    {
      id: 'claude-3-5-haiku-latest',
      name: 'Claude 3.5 Haiku',
      provider: 'anthropic',
      requires_api_key: true,
      env_var: 'ANTHROPIC_API_KEY'
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      requires_api_key: true,
      env_var: 'OPENAI_API_KEY'
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: 'openai',
      requires_api_key: true,
      env_var: 'OPENAI_API_KEY'
    },
    {
      id: 'o1-preview',
      name: 'O1 Preview',
      provider: 'openai',
      requires_api_key: true,
      env_var: 'OPENAI_API_KEY'
    },
    {
      id: 'o1-mini',
      name: 'O1 Mini',
      provider: 'openai',
      requires_api_key: true,
      env_var: 'OPENAI_API_KEY'
    },
    {
      id: 'gemini-1-5-pro-002',
      name: 'Gemini 1.5 Pro',
      provider: 'google',
      requires_api_key: true,
      env_var: 'GOOGLE_API_KEY'
    },
    {
      id: 'gemini-1-5-flash-002',
      name: 'Gemini 1.5 Flash',
      provider: 'google',
      requires_api_key: true,
      env_var: 'GOOGLE_API_KEY'
    },
    {
      id: 'gemini-2-0-flash-exp',
      name: 'Gemini 2.0 Flash Experimental',
      provider: 'google',
      requires_api_key: true,
      env_var: 'GOOGLE_API_KEY'
    },
    {
      id: 'deepseek-chat',
      name: 'DeepSeek Chat',
      provider: 'deepseek',
      requires_api_key: true,
      env_var: 'DEEPSEEK_API_KEY'
    },
    {
      id: 'bedrock-claude-3-5-sonnet-v2',
      name: 'Bedrock Claude 3.5 Sonnet v2',
      provider: 'aws',
      requires_api_key: true,
      env_var: 'AWS_ACCESS_KEY_ID'
    },
    {
      id: 'bedrock-claude-3-5-haiku',
      name: 'Bedrock Claude 3.5 Haiku',
      provider: 'aws',
      requires_api_key: true,
      env_var: 'AWS_ACCESS_KEY_ID'
    },
    {
      id: 'qwen-coder-plus-latest',
      name: 'Qwen Coder Plus',
      provider: 'alibaba',
      requires_api_key: true,
      env_var: 'DASHSCOPE_API_KEY'
    }
  ];

  const configuredExecutors = executors.map(executor => ({
    ...executor,
    is_configured: !!process.env[executor.env_var]
  }));

  res.json(configuredExecutors);
});

router.get('/environment', async (req: Request, res: Response) => {
  const allowedEnvVars = [
    'NODE_ENV',
    'PORT',
    'BACKEND_PORT',
    'FRONTEND_PORT',
    'HOST',
    'DATABASE_URL',
    'GITHUB_CLIENT_ID',
    'POSTHOG_API_KEY',
    'DISABLE_WORKTREE_ORPHAN_CLEANUP'
  ];

  const environment: Record<string, string | undefined> = {};
  
  for (const key of allowedEnvVars) {
    environment[key] = process.env[key];
  }

  res.json(environment);
});

export const configRoutes = router;