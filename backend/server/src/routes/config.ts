import { Router, Request, Response } from 'express';
import { ProfileService } from '../../../services/src/services/profileService';
import { configService, SoundFile, soundFileToPath } from '../../../services/src/services/config';
import { logger } from '../../../utils/src/logger';
import { promises as fs } from 'fs';
import path from 'path';
import { McpConfigManager, McpConfig } from '../../../executors/src/mcp_config';
import { AssetManager } from '../../../utils/src/assets';

const router = Router();
const profileService = ProfileService.getInstance();

// Initialize AssetManager once when the module loads
AssetManager.initialize().catch(error => {
  logger.error('Failed to initialize AssetManager:', error);
});

// GET /api/config/profiles
router.get('/profiles', async (req: Request, res: Response) => {
  try {
    const profiles = await profileService.getProfiles();
    
    res.json({
      success: true,
      data: {
        profiles: profiles
      },
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get profiles:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get profiles'
    });
  }
});

// PUT /api/config/profiles
router.put('/profiles', async (req: Request, res: Response) => {
  try {
    const { profiles } = req.body;
    
    if (!profiles || !Array.isArray(profiles)) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Invalid profiles data'
      });
    }

    await profileService.saveProfiles(profiles);
    
    res.json({
      success: true,
      data: 'Profiles updated successfully',
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to update profiles:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to update profiles'
    });
  }
});

// GET /api/config/profiles/:label
router.get('/profiles/:label', async (req: Request, res: Response) => {
  try {
    const { label } = req.params;
    const { variant } = req.query;
    
    const result = await profileService.getProfileWithVariant(label, variant as string);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Profile not found'
      });
    }

    res.json({
      success: true,
      data: result,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get profile:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get profile'
    });
  }
});

// GET /api/config/system-info
router.get('/system-info', async (req: Request, res: Response) => {
  try {
    const packageJson = require('../../package.json');
    const profiles = await profileService.getProfiles();
    
    const config = {
      version: packageJson.version || '0.0.1',
      platform: require('os').platform(),
      arch: require('os').arch(),
      node_version: process.version,
      data_dir: require('path').join(process.cwd(), 'data'),
      analytics_enabled: !!process.env.POSTHOG_API_KEY,
      available_executors: profiles.map(p => p.label)
    };

    const environment = {
      os_type: require('os').type(),
      os_version: require('os').release(),
      os_architecture: require('os').arch(),
      bitness: require('os').arch().includes('64') ? '64-bit' : '32-bit'
    };

    const userSystemInfo = {
      config,
      environment,
      profiles: profiles.map(profile => ({
        label: profile.label,
        mcp_config_path: profile.mcp_config_path,
        variants: profile.variants.map(v => ({
          label: v.label,
          mcp_config_path: v.mcp_config_path
        }))
      }))
    };

    res.json({
      success: true,
      data: userSystemInfo,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get system info:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get system info'
    });
  }
});

// GET /api/config - Get current configuration
router.get('/config', async (req: Request, res: Response) => {
  try {
    const config = await configService.getConfig();
    
    res.json({
      success: true,
      data: config,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get config:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get configuration'
    });
  }
});

// PUT /api/config - Update configuration (matches Rust's /config route)
router.put('/config', async (req: Request, res: Response) => {
  try {
    const newConfig = req.body;
    
    // Match Rust's validation behavior - return 400 with plain text for missing/invalid body
    if (!newConfig || Object.keys(newConfig).length === 0) {
      res.status(400);
      res.type('text/plain');
      return res.send('Failed to parse the request body as JSON: EOF while parsing a value at line 1 column 0');
    }

    // Save the updated configuration using configService
    await configService.saveConfig(newConfig);
    
    logger.info('Configuration updated successfully');
    
    res.json({
      success: true,
      data: newConfig,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to update config:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to save configuration'
    });
  }
});

// GET /api/sounds/:sound - Get sound file
router.get('/sounds/:sound', async (req: Request, res: Response) => {
  try {
    const soundParam = req.params.sound;
    
    // Convert parameter to SoundFile enum
    let soundFile: SoundFile | undefined;
    
    // The API expects the enum value (e.g., "COW_MOOING")
    if (Object.values(SoundFile).includes(soundParam as SoundFile)) {
      soundFile = soundParam as SoundFile;
    } else {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Sound file not found'
      });
    }
    
    // Get the sound file path using AssetManager
    const soundFileName = soundFileToPath(soundFile);
    
    // Get the sound file path
    const soundPath = await AssetManager.getSoundPath(soundFileName);
    
    if (!soundPath) {
      logger.error(`Sound file not found: ${soundFileName}`);
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Sound file not found'
      });
    }
    
    // Read the sound file
    const soundData = await fs.readFile(soundPath);
    
    // Send the sound file with appropriate headers
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', soundData.length);
    res.send(soundData);
  } catch (error) {
    logger.error('Failed to get sound file:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get sound file'
    });
  }
});

// GET /api/mcp-config - Get MCP server configuration
router.get('/mcp-config', async (req: Request, res: Response) => {
  try {
    const { profile: profileLabel } = req.query;
    
    if (!profileLabel || typeof profileLabel !== 'string') {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Profile parameter is required'
      });
    }
    
    // Get the profile
    const profiles = await profileService.getProfiles();
    const profile = profiles.find(p => p.label === profileLabel);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: `Profile not found: ${profileLabel}`
      });
    }
    
    // Check if agent supports MCP
    if (!profile.supports_mcp) {
      return res.json({
        success: false,
        data: null,
        error_data: null,
        message: 'This executor does not support MCP servers'
      });
    }
    
    // Get the MCP config path
    const configPath = profile.mcp_config_path || McpConfigManager.getAgentMcpConfigPath(profileLabel);
    
    if (!configPath) {
      return res.json({
        success: false,
        data: null,
        error_data: null,
        message: 'Could not determine config file path'
      });
    }
    
    // Get the MCP config for this agent
    const defaultConfigs = McpConfigManager.getDefaultMcpConfigs();
    const mcpConfig = defaultConfigs[profileLabel] || McpConfigManager.create(
      ['mcpServers'],
      { mcpServers: {} },
      {
        command: 'npx',
        args: ['-y', 'vibe-kanban', '--mcp'],
        env: {}
      },
      false
    );
    
    // Read the actual config
    const rawConfig = await McpConfigManager.readAgentConfig(configPath, mcpConfig);
    const servers = McpConfigManager.getServers(rawConfig, mcpConfig.servers_path);
    
    // Build response
    const response = {
      mcp_config: {
        servers,
        servers_path: mcpConfig.servers_path,
        template: mcpConfig.template,
        vibe_kanban: mcpConfig.vibe_kanban,
        is_toml_config: mcpConfig.is_toml_config
      },
      config_path: configPath
    };
    
    res.json({
      success: true,
      data: response,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get MCP config:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: error instanceof Error ? error.message : 'Failed to get MCP configuration'
    });
  }
});

// POST /api/mcp-config - Update MCP server configuration
router.post('/mcp-config', async (req: Request, res: Response) => {
  try {
    const { profile: profileLabel } = req.query;
    const { servers } = req.body;
    
    if (!profileLabel || typeof profileLabel !== 'string') {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Profile parameter is required'
      });
    }
    
    if (!servers || typeof servers !== 'object') {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Servers configuration is required'
      });
    }
    
    // Get the profile
    const profiles = await profileService.getProfiles();
    const profile = profiles.find(p => p.label === profileLabel);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: `Profile not found: ${profileLabel}`
      });
    }
    
    // Check if agent supports MCP
    if (!profile.supports_mcp) {
      return res.json({
        success: false,
        data: null,
        error_data: null,
        message: 'This executor does not support MCP servers'
      });
    }
    
    // Get the MCP config path
    const configPath = profile.mcp_config_path || McpConfigManager.getAgentMcpConfigPath(profileLabel);
    
    if (!configPath) {
      return res.json({
        success: false,
        data: null,
        error_data: null,
        message: 'Could not determine config file path'
      });
    }
    
    // Get the MCP config for this agent
    const defaultConfigs = McpConfigManager.getDefaultMcpConfigs();
    const mcpConfig = defaultConfigs[profileLabel] || McpConfigManager.create(
      ['mcpServers'],
      { mcpServers: {} },
      {
        command: 'npx',
        args: ['-y', 'vibe-kanban', '--mcp'],
        env: {}
      },
      false
    );
    
    // Read current config
    const currentConfig = await McpConfigManager.readAgentConfig(configPath, mcpConfig);
    const oldServers = McpConfigManager.getServers(currentConfig, mcpConfig.servers_path);
    const oldCount = Object.keys(oldServers).length;
    
    // Update the servers
    await McpConfigManager.updateMcpServers(configPath, mcpConfig, servers);
    
    // Build success message
    const newCount = Object.keys(servers).length;
    let message: string;
    if (oldCount === 0 && newCount === 0) {
      message = 'No MCP servers configured';
    } else if (oldCount === 0 && newCount > 0) {
      message = `Added ${newCount} MCP server(s)`;
    } else if (oldCount === newCount) {
      message = `Updated MCP server configuration (${newCount} server(s))`;
    } else {
      message = `Updated MCP server configuration (was ${oldCount}, now ${newCount})`;
    }
    
    res.json({
      success: true,
      data: message,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to update MCP config:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: error instanceof Error ? error.message : 'Failed to update MCP servers'
    });
  }
});

export const configRoutes = router;