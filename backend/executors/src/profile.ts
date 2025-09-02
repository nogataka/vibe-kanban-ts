import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';

// Executor types
export enum ExecutorType {
  CLAUDE_CODE = 'claude_code',
  AMP = 'amp', 
  GEMINI = 'gemini',
  CODEX = 'codex',
  OPENCODE = 'opencode',
  CURSOR = 'cursor'
}

export interface CommandConfig {
  base: string;
  params: string[];
}

// Profile variant agent configuration
export interface VariantAgentConfig {
  /** Unique identifier for this profile */
  label: string;
  /** The coding agent type */
  agent_type: ExecutorType;
  /** Command configuration */
  command?: CommandConfig;
  /** Optional profile-specific MCP config file path */
  mcp_config_path?: string;
  /** Additional agent-specific settings */
  settings?: Record<string, any>;
}

// Profile configuration with default and variants
export interface ProfileConfig {
  /** Default profile variant */
  default: VariantAgentConfig;
  /** Additional variants for this profile */
  variants: VariantAgentConfig[];
}

// Profile variant label for identification
export interface ProfileVariantLabel {
  profile: string;
  variant?: string;
}

// Complete profile configurations
export interface ProfileConfigs {
  profiles: ProfileConfig[];
}

// Default profiles configuration
const DEFAULT_PROFILES: ProfileConfigs = {
  profiles: [
    {
      default: {
        label: 'claude-code',
        agent_type: ExecutorType.CLAUDE_CODE,
        command: {
          base: 'npx',
          params: ['-y', '@anthropic-ai/claude-code@latest', '-p', '--dangerously-skip-permissions', '--verbose', '--output-format=stream-json']
        },
        settings: { plan: false }
      },
      variants: [
        {
          label: 'plan',
          agent_type: ExecutorType.CLAUDE_CODE,
          command: {
            base: 'npx',
            params: ['-y', '@anthropic-ai/claude-code@latest', '-p', '--permission-mode=plan', '--verbose', '--output-format=stream-json']
          },
          settings: { plan: true }
        }
      ]
    },
    {
      default: {
        label: 'claude-code-router',
        agent_type: ExecutorType.CLAUDE_CODE,
        command: {
          base: 'npx',
          params: ['-y', '@musistudio/claude-code-router', 'code', '-p', '--dangerously-skip-permissions', '--verbose', '--output-format=stream-json']
        }
      },
      variants: []
    },
    {
      default: {
        label: 'amp',
        agent_type: ExecutorType.AMP,
        command: {
          base: 'npx',
          params: ['-y', '@sourcegraph/amp@latest', '--execute', '--stream-json', '--dangerously-allow-all']
        }
      },
      variants: []
    },
    {
      default: {
        label: 'gemini',
        agent_type: ExecutorType.GEMINI,
        command: {
          base: 'npx',
          params: ['-y', '@google/gemini-cli@latest', '--yolo']
        }
      },
      variants: [
        {
          label: 'flash',
          agent_type: ExecutorType.GEMINI,
          command: {
            base: 'npx',
            params: ['-y', '@google/gemini-cli@latest', '--yolo', '--model', 'gemini-2.5-flash']
          }
        }
      ]
    },
    {
      default: {
        label: 'codex',
        agent_type: ExecutorType.CODEX,
        command: {
          base: 'npx',
          params: ['-y', '@openai/codex', 'exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check']
        }
      },
      variants: []
    },
    {
      default: {
        label: 'opencode',
        agent_type: ExecutorType.OPENCODE,
        command: {
          base: 'npx',
          params: ['-y', 'opencode-ai@latest', 'run', '--print-logs']
        }
      },
      variants: []
    },
    {
      default: {
        label: 'cursor',
        agent_type: ExecutorType.CURSOR,
        command: {
          base: 'cursor-agent',
          params: ['-p', '--output-format=stream-json', '--force']
        }
      },
      variants: []
    }
  ]
};

export class ProfileManager {
  private static instance: ProfileManager | null = null;
  private profilesCache: ProfileConfigs | null = null;
  private profilesPath: string;

  private constructor() {
    // Use project-specific profiles path
    this.profilesPath = path.join(process.cwd(), 'data', 'profiles.json');
  }

  static getInstance(): ProfileManager {
    if (!ProfileManager.instance) {
      ProfileManager.instance = new ProfileManager();
    }
    return ProfileManager.instance;
  }

  /**
   * Get cached profiles configuration
   */
  getCachedProfiles(): ProfileConfigs {
    if (!this.profilesCache) {
      this.profilesCache = this.loadProfiles();
    }
    return this.profilesCache;
  }

  /**
   * Reload profiles from disk
   */
  reloadProfiles(): void {
    this.profilesCache = this.loadProfiles();
  }

  /**
   * Load profiles from file or return defaults
   */
  private loadProfiles(): ProfileConfigs {
    try {
      const content = require('fs').readFileSync(this.profilesPath, 'utf-8');
      const profiles = JSON.parse(content) as ProfileConfigs;
      logger.info('Loaded profiles from profiles.json');
      return profiles;
    } catch (error) {
      logger.warn(`Failed to read profiles.json: ${error}, using defaults`);
      return this.fromDefaults();
    }
  }

  /**
   * Get default profiles configuration
   */
  fromDefaults(): ProfileConfigs {
    return JSON.parse(JSON.stringify(DEFAULT_PROFILES));
  }

  /**
   * Get a specific profile by name
   */
  getProfile(profileName: string): ProfileConfig | null {
    const profiles = this.getCachedProfiles();
    return profiles.profiles.find(p => p.default.label === profileName) || null;
  }

  /**
   * Get a specific variant of a profile
   */
  getProfileVariant(profileName: string, variantName: string): VariantAgentConfig | null {
    const profile = this.getProfile(profileName);
    if (!profile) return null;

    return profile.variants.find(v => v.label === variantName) || null;
  }

  /**
   * Get the effective configuration for a profile variant label
   */
  getEffectiveConfig(label: ProfileVariantLabel): VariantAgentConfig | null {
    const profile = this.getProfile(label.profile);
    if (!profile) return null;

    if (label.variant) {
      return this.getProfileVariant(label.profile, label.variant) || profile.default;
    }

    return profile.default;
  }

  /**
   * Get all available profile names
   */
  getAvailableProfiles(): string[] {
    const profiles = this.getCachedProfiles();
    return profiles.profiles.map(p => p.default.label);
  }

  /**
   * Get all variants for a specific profile
   */
  getProfileVariants(profileName: string): string[] {
    const profile = this.getProfile(profileName);
    if (!profile) return [];

    return profile.variants.map(v => v.label);
  }

  /**
   * Check if a profile supports MCP
   */
  profileSupportsMcp(profileName: string): boolean {
    const profile = this.getProfile(profileName);
    if (!profile) return false;

    // Check if default config has MCP support
    return this.agentSupportsMcp(profile.default.agent_type);
  }

  /**
   * Check if an agent type supports MCP
   */
  private agentSupportsMcp(agentType: ExecutorType): boolean {
    switch (agentType) {
      case ExecutorType.CLAUDE_CODE:
      case ExecutorType.CURSOR:
        return true;
      default:
        return false;
    }
  }

  /**
   * Get default MCP config path for an agent type
   */
  getDefaultMcpConfigPath(agentType: ExecutorType): string | null {
    switch (agentType) {
      case ExecutorType.CLAUDE_CODE:
        return path.join(require('os').homedir(), '.config', 'claude', 'config.json');
      case ExecutorType.CURSOR:
        return path.join(require('os').homedir(), '.cursor', 'config.json');
      default:
        return null;
    }
  }

  /**
   * Save profiles to disk
   */
  async saveProfiles(profiles: ProfileConfigs): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.profilesPath);
      await fs.mkdir(dir, { recursive: true });

      // Write profiles
      const content = JSON.stringify(profiles, null, 2);
      await fs.writeFile(this.profilesPath, content, 'utf-8');

      // Update cache
      this.profilesCache = profiles;
      
      logger.info('Profiles saved successfully');
    } catch (error) {
      logger.error('Failed to save profiles:', error);
      throw new Error(`Failed to save profiles: ${error}`);
    }
  }

  /**
   * Add or update a profile
   */
  async addOrUpdateProfile(profileConfig: ProfileConfig): Promise<void> {
    const profiles = this.getCachedProfiles();
    
    // Find existing profile index
    const existingIndex = profiles.profiles.findIndex(
      p => p.default.label === profileConfig.default.label
    );

    if (existingIndex >= 0) {
      // Update existing profile
      profiles.profiles[existingIndex] = profileConfig;
    } else {
      // Add new profile
      profiles.profiles.push(profileConfig);
    }

    await this.saveProfiles(profiles);
  }

  /**
   * Remove a profile
   */
  async removeProfile(profileName: string): Promise<boolean> {
    const profiles = this.getCachedProfiles();
    const initialLength = profiles.profiles.length;
    
    profiles.profiles = profiles.profiles.filter(p => p.default.label !== profileName);
    
    if (profiles.profiles.length < initialLength) {
      await this.saveProfiles(profiles);
      return true;
    }
    
    return false;
  }

  /**
   * Extend profiles from a file (merge with existing)
   */
  async extendFromFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const userProfiles = JSON.parse(content) as ProfileConfigs;
      
      const currentProfiles = this.getCachedProfiles();
      const existingLabels = new Set(currentProfiles.profiles.map(p => p.default.label));
      
      // Add only profiles with unique labels
      for (const userProfile of userProfiles.profiles) {
        if (!existingLabels.has(userProfile.default.label)) {
          currentProfiles.profiles.push(userProfile);
        } else {
          logger.debug(`Skipping profile ${userProfile.default.label} (already exists)`);
        }
      }
      
      await this.saveProfiles(currentProfiles);
      logger.info(`Extended profiles from ${filePath}`);
    } catch (error) {
      logger.error(`Failed to extend from file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Validate a profile configuration
   */
  validateProfile(profile: ProfileConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check default configuration
    if (!profile.default.label) {
      errors.push('Profile default label is required');
    }

    if (!profile.default.agent_type) {
      errors.push('Profile default agent_type is required');
    }

    if (!Object.values(ExecutorType).includes(profile.default.agent_type)) {
      errors.push(`Invalid agent_type: ${profile.default.agent_type}`);
    }

    // Check variants
    for (const variant of profile.variants) {
      if (!variant.label) {
        errors.push('Variant label is required');
      }

      if (!variant.agent_type) {
        errors.push(`Variant ${variant.label} agent_type is required`);
      }

      if (!Object.values(ExecutorType).includes(variant.agent_type)) {
        errors.push(`Invalid agent_type in variant ${variant.label}: ${variant.agent_type}`);
      }
    }

    // Check for duplicate variant labels
    const variantLabels = profile.variants.map(v => v.label);
    const uniqueLabels = new Set(variantLabels);
    if (variantLabels.length !== uniqueLabels.size) {
      errors.push('Duplicate variant labels found');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get profile statistics
   */
  getProfileStats(): {
    totalProfiles: number;
    profilesWithVariants: number;
    totalVariants: number;
    mcpEnabledProfiles: number;
  } {
    const profiles = this.getCachedProfiles();
    
    return {
      totalProfiles: profiles.profiles.length,
      profilesWithVariants: profiles.profiles.filter(p => p.variants.length > 0).length,
      totalVariants: profiles.profiles.reduce((sum, p) => sum + p.variants.length, 0),
      mcpEnabledProfiles: profiles.profiles.filter(p => this.profileSupportsMcp(p.default.label)).length
    };
  }
}

// Export utility functions
export const ProfileUtils = {
  /**
   * Create a default profile variant label
   */
  defaultLabel(profile: string): ProfileVariantLabel {
    return { profile };
  },

  /**
   * Create a profile variant label with variant
   */
  withVariant(profile: string, variant: string): ProfileVariantLabel {
    return { profile, variant };
  },

  /**
   * Format profile variant label as string
   */
  formatLabel(label: ProfileVariantLabel): string {
    return label.variant ? `${label.profile}:${label.variant}` : label.profile;
  },

  /**
   * Parse a profile variant label from string
   */
  parseLabel(labelString: string): ProfileVariantLabel {
    const parts = labelString.split(':');
    return {
      profile: parts[0],
      variant: parts[1] || undefined
    };
  }
};
