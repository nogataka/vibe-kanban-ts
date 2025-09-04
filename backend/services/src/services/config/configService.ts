import { promises as fs } from 'fs';
import { dirname } from 'path';
import { logger } from '../../../../utils/src/logger';
import { getConfigPath } from '../../../../utils/src/assetDir';

export enum SoundFile {
  ABSTRACT_SOUND1 = 'ABSTRACT_SOUND1',
  ABSTRACT_SOUND2 = 'ABSTRACT_SOUND2',
  ABSTRACT_SOUND3 = 'ABSTRACT_SOUND3',
  ABSTRACT_SOUND4 = 'ABSTRACT_SOUND4',
  COW_MOOING = 'COW_MOOING',
  PHONE_VIBRATION = 'PHONE_VIBRATION',
  ROOSTER = 'ROOSTER',
}

export const soundFileToPath = (sound: SoundFile): string => {
  const mapping: Record<SoundFile, string> = {
    [SoundFile.ABSTRACT_SOUND1]: 'abstract-sound1.wav',
    [SoundFile.ABSTRACT_SOUND2]: 'abstract-sound2.wav',
    [SoundFile.ABSTRACT_SOUND3]: 'abstract-sound3.wav',
    [SoundFile.ABSTRACT_SOUND4]: 'abstract-sound4.wav',
    [SoundFile.COW_MOOING]: 'cow-mooing.wav',
    [SoundFile.PHONE_VIBRATION]: 'phone-vibration.wav',
    [SoundFile.ROOSTER]: 'rooster.wav',
  };
  return mapping[sound];
};

export interface NotificationConfig {
  sound_enabled: boolean;
  push_enabled: boolean;
  sound_file: SoundFile;
}

export interface EditorType {
  // Will be filled when needed
}

export interface EditorConfig {
  editor_type?: EditorType;
  custom_command?: string;
}

export interface ThemeMode {
  // Will be filled when needed
}

export interface GitHubConfig {
  username?: string;
  primary_email?: string;
  oauth_token?: string;
  pat?: string; // Personal Access Token
  default_pr_base?: string; // Default PR base branch
}

export interface AppConfig {
  config_version?: string;
  theme?: string;
  profile?: any;
  github: GitHubConfig;
  github_login_acknowledged: boolean;
  onboarding_acknowledged: boolean;
  disclaimer_acknowledged: boolean;
  telemetry_acknowledged: boolean;
  show_release_notes: boolean;
  notifications?: NotificationConfig;
  editor?: EditorConfig;
  analytics_enabled?: boolean;
  workspace_dir?: string;
  last_app_version?: string;
}

export class ConfigService {
  private configPath: string;

  constructor() {
    // Use the same directory as Rust version
    this.configPath = getConfigPath();
  }

  private getDefaultConfig(): AppConfig {
    return {
      config_version: 'v5',
      theme: 'SYSTEM',
      profile: { label: 'claude-code' },
      github: {},
      github_login_acknowledged: false,
      onboarding_acknowledged: false,
      disclaimer_acknowledged: false,
      telemetry_acknowledged: false,
      show_release_notes: false,
      notifications: {
        sound_enabled: true,
        push_enabled: true,
        sound_file: SoundFile.COW_MOOING,
      },
      editor: {},
      analytics_enabled: null,
      workspace_dir: null,
      last_app_version: null,
    };
  }

  async loadConfig(): Promise<AppConfig> {
    // Always read from file (matching Rust behavior - no caching)

    try {
      await this.ensureConfigDirectoryExists();
      
      if (await this.configFileExists()) {
        const configContent = await fs.readFile(this.configPath, 'utf-8');
        const fileConfig = JSON.parse(configContent);
        const defaultConfig = this.getDefaultConfig();
        
        // Deep merge configuration, with file config taking precedence
        const config = {
          ...defaultConfig,
          ...fileConfig,
          // Deep merge nested objects
          github: {
            ...defaultConfig.github,
            ...fileConfig.github
          },
          notifications: fileConfig.notifications || defaultConfig.notifications,
          editor: fileConfig.editor || defaultConfig.editor
        };
        logger.info('Configuration loaded successfully');
        return config;
      } else {
        const config = this.getDefaultConfig();
        await this.saveConfig(config);
        logger.info('Created new default configuration');
        return config;
      }
    } catch (error) {
      logger.error('Failed to load configuration, using defaults:', error);
      return this.getDefaultConfig();
    }
  }

  async saveConfig(config: AppConfig): Promise<void> {
    if (!config) {
      throw new Error('No configuration to save');
    }

    try {
      await this.ensureConfigDirectoryExists();
      
      const configJson = JSON.stringify(config, null, 2);
      await fs.writeFile(this.configPath, configJson, 'utf-8');
      
      logger.info('Configuration saved successfully');
    } catch (error) {
      logger.error('Failed to save configuration:', error);
      throw error;
    }
  }

  async updateGitHubConfig(githubConfig: Partial<GitHubConfig>): Promise<void> {
    const currentConfig = await this.loadConfig();
    
    currentConfig.github = {
      ...currentConfig.github,
      ...githubConfig,
    };
    
    // Also acknowledge GitHub login when setting OAuth token
    if (githubConfig.oauth_token) {
      currentConfig.github_login_acknowledged = true;
    }

    await this.saveConfig(currentConfig);
  }

  async getConfig(): Promise<AppConfig> {
    return this.loadConfig();
  }

  getConfigPath(): string {
    return this.configPath;
  }

  private async ensureConfigDirectoryExists(): Promise<void> {
    const configDir = dirname(this.configPath);
    try {
      await fs.access(configDir);
    } catch {
      await fs.mkdir(configDir, { recursive: true });
      logger.info(`Created config directory: ${configDir}`);
    }
  }

  private async configFileExists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  // Method to reset config (for testing or reset functionality)
  async resetConfig(): Promise<void> {
    const config = this.getDefaultConfig();
    await this.saveConfig(config);
  }

  // Method to check if GitHub is configured
  async isGitHubConfigured(): Promise<boolean> {
    const config = await this.loadConfig();
    return !!(config?.github?.oauth_token);
  }

  // Get GitHub token (similar to Rust's token() method)
  async getGitHubToken(): Promise<string | null> {
    const config = await this.loadConfig();
    return config?.github?.oauth_token || null;
  }
}

// Singleton instance
export const configService = new ConfigService();
