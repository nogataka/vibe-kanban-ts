import { Express, Request, Response } from 'express';
import { healthRoutes } from './health';
import { projectRoutes } from './projects';
import { githubRoutes } from './github';
import { filesystemRoutes } from './filesystem';
import { configRoutes } from './config';
import { taskRoutes } from './tasks';
import { taskTemplateRoutes } from './taskTemplates';
import templatesRoutes from './templates';
import { taskAttemptRoutes } from './taskAttempts';
import { containerRoutes } from './containers';
import { eventsRoutes } from './events';
import { executionProcessRoutes } from './executionProcesses';
import { imageRoutes } from './images';
import { authRoutes } from './auth';
import { frontendRoutes } from './frontend';
import { debugRoutes } from './debug/debug';
import * as os from 'os';
import { configService } from '../../../services/src/services/config/configService';
import { ProfileService } from '../../../services/src/services/profileService';

export function setupRoutes(app: Express): void {
  // Direct /api/info endpoint for UserSystemInfo (must be before other routes)
  app.get('/api/info', async (req: Request, res: Response) => {
    try {
      // Load config from configService to get actual values
      const appConfig = await configService.loadConfig();
      
      // Load profiles from ProfileService to match Rust structure
      const profileService = ProfileService.getInstance();
      const profiles = await profileService.getProfiles();
      
      // UserSystemInfo 型に合わせた構造 (matching Rust's structure)
      const userSystemInfo = {
        config: {
          config_version: 'v5',  // Match Rust version
          theme: 'SYSTEM',
          profile: {
            profile: 'claude-code',
            variant: null
          },
          disclaimer_acknowledged: appConfig.disclaimer_acknowledged,
          onboarding_acknowledged: appConfig.onboarding_acknowledged,
          github_login_acknowledged: appConfig.github_login_acknowledged,
          telemetry_acknowledged: appConfig.telemetry_acknowledged,
          notifications: {
            sound_enabled: false,
            push_enabled: false,
            sound_file: 'ABSTRACT_SOUND1'
          },
          editor: {
            editor_type: 'VS_CODE',
            custom_command: null
          },
          github: {
            pat: null,
            oauth_token: appConfig.github.oauth_token || null,
            username: appConfig.github.username || null,
            primary_email: appConfig.github.primary_email || null,
            default_pr_base: 'main'
          },
          analytics_enabled: false,
          workspace_dir: process.cwd(),
          last_app_version: '1.0.0',
          show_release_notes: appConfig.show_release_notes
        },
        environment: {
          os_type: os.type(),
          os_version: os.release(),
          os_architecture: os.arch(),
          bitness: process.arch.includes('64') ? '64-bit' : '32-bit'
        },
        profiles: profiles  // Use actual profiles from ProfileService
      };

      res.json({
        success: true,
        data: userSystemInfo,
        error_data: null,
        message: null
      });
    } catch (error) {
      console.error('Failed to get info:', error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Failed to get system information'
      });
    }
  });

  // Health check
  app.use('/api/health', healthRoutes);
  
  // Authentication
  app.use('/api/auth', authRoutes);
  
  // Project management  
  app.use('/api/projects', projectRoutes);
  
  // GitHub integration
  app.use('/api/github', githubRoutes);
  
  // Filesystem operations
  app.use('/api/filesystem', filesystemRoutes);
  
  // Configuration routes - using the config router but need to modify paths
  // We'll mount specific config routes at the /api level to match Rust
  app.use('/api', configRoutes);
  
  // Tasks management
  app.use('/api/tasks', taskRoutes);
  
  // Task templates management
  app.use('/api/task-templates', taskTemplateRoutes);
  
  // Templates management (for /api/templates endpoint)
  app.use('/api/templates', templatesRoutes);
  
  // Task attempts management
  app.use('/api/task-attempts', taskAttemptRoutes);
  
  // Container management
  app.use('/api/containers', containerRoutes);
  
  // Event management
  app.use('/api/events', eventsRoutes);
  
  // Execution processes
  app.use('/api/execution-processes', executionProcessRoutes);
  
  // Image management
  app.use('/api/images', imageRoutes);
  
  // Debug routes (development only)
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/debug', debugRoutes);
  }
  
  // Frontend routes
  app.use('/', frontendRoutes);

  // Catch-all for unhandled API routes
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({ 
      error: 'API route not found', 
      path: req.path,
      method: req.method
    });
  });
}
