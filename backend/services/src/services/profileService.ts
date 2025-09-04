import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../../utils/src/logger';
import { Profile, ProfileVariant } from '../../../executors/src/actions/types';

export class ProfileService {
  private static instance: ProfileService;
  private profilesCache: Profile[] | null = null;
  private defaultProfilesPath: string;

  private constructor() {
    this.defaultProfilesPath = path.join(__dirname, '../../assets/default_profiles.json');
  }

  static getInstance(): ProfileService {
    if (!ProfileService.instance) {
      ProfileService.instance = new ProfileService();
    }
    return ProfileService.instance;
  }

  async getProfiles(): Promise<Profile[]> {
    if (this.profilesCache) {
      return this.profilesCache;
    }

    try {
      // Try to load from file system first
      const profilesExist = await fs.access(this.defaultProfilesPath)
        .then(() => true)
        .catch(() => false);

      if (profilesExist) {
        const profilesData = await fs.readFile(this.defaultProfilesPath, 'utf8');
        const parsed = JSON.parse(profilesData);
        // Add supports_mcp field based on executor type
        const profiles = parsed.profiles || this.getDefaultProfiles();
        this.profilesCache = profiles.map((profile: Profile) => ({
          ...profile,
          supports_mcp: this.getSupportsMapForProfile(profile.label),
          variants: profile.variants.map((variant: ProfileVariant) => ({
            ...variant,
            supports_mcp: this.getSupportsMapForProfile(profile.label)
          }))
        }));
      } else {
        // Create default profiles file
        this.profilesCache = this.getDefaultProfiles();
        await this.saveProfiles(this.profilesCache);
      }

      return this.profilesCache;
    } catch (error) {
      logger.error('Failed to load profiles, using defaults:', error);
      this.profilesCache = this.getDefaultProfiles();
      return this.profilesCache;
    }
  }

  async saveProfiles(profiles: Profile[]): Promise<void> {
    try {
      const profilesData = {
        profiles: profiles
      };

      // Ensure directory exists before writing
      const dir = path.dirname(this.defaultProfilesPath);
      await fs.mkdir(dir, { recursive: true }).catch(() => {});

      await fs.writeFile(
        this.defaultProfilesPath,
        JSON.stringify(profilesData, null, 2),
        'utf8'
      );

      this.profilesCache = profiles;
      logger.info('Profiles saved successfully');
    } catch (error) {
      logger.error('Failed to save profiles:', error);
      throw error;
    }
  }

  async getProfile(label: string): Promise<Profile | null> {
    const profiles = await this.getProfiles();
    return profiles.find(p => p.label === label) || null;
  }

  async getProfileWithVariant(label: string, variantLabel?: string): Promise<{profile: Profile, variant?: ProfileVariant} | null> {
    const profile = await this.getProfile(label);
    if (!profile) {
      return null;
    }

    if (!variantLabel) {
      return { profile };
    }

    const variant = profile.variants.find(v => v.label === variantLabel);
    return { profile, variant };
  }

  private getDefaultProfiles(): Profile[] {
    return [
      {
        label: 'claude-code',
        mcp_config_path: null,
        supports_mcp: true,
        CLAUDE_CODE: {
          command: {
            base: 'npx -y @anthropic-ai/claude-code@latest',
            params: ['-p', '--dangerously-skip-permissions', '--verbose', '--output-format=stream-json']
          },
          plan: false
        },
        variants: [
          {
            label: 'plan',
            mcp_config_path: null,
            CLAUDE_CODE: {
              command: {
                base: 'npx -y @anthropic-ai/claude-code@latest',
                params: ['-p', '--permission-mode=plan', '--verbose', '--output-format=stream-json']
              },
              plan: true
            }
          }
        ]
      },
      {
        label: 'claude-code-router',
        mcp_config_path: null,
        supports_mcp: false,
        CLAUDE_CODE: {
          command: {
            base: 'npx -y @musistudio/claude-code-router code',
            params: ['-p', '--dangerously-skip-permissions', '--verbose', '--output-format=stream-json']
          },
          plan: false
        },
        variants: []
      },
      {
        label: 'amp',
        mcp_config_path: null,
        supports_mcp: true,
        AMP: {
          command: {
            base: 'npx -y @sourcegraph/amp@latest',
            params: ['--execute', '--stream-json', '--dangerously-allow-all']
          }
        },
        variants: []
      },
      {
        label: 'gemini',
        mcp_config_path: null,
        supports_mcp: true,
        GEMINI: {
          command: {
            base: 'npx -y @google/gemini-cli@latest',
            params: ['--yolo']
          }
        },
        variants: [
          {
            label: 'flash',
            mcp_config_path: null,
            GEMINI: {
              command: {
                base: 'npx -y @google/gemini-cli@latest',
                params: ['--yolo', '--model', 'gemini-2.5-flash']
              }
            }
          }
        ]
      },
      {
        label: 'codex',
        mcp_config_path: null,
        supports_mcp: true,
        CODEX: {
          command: {
            base: 'npx -y @openai/codex exec',
            params: ['--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check']
          }
        },
        variants: []
      },
      {
        label: 'opencode',
        mcp_config_path: null,
        supports_mcp: true,
        OPENCODE: {
          command: {
            base: 'npx -y opencode-ai@latest run',
            params: ['--print-logs']
          }
        },
        variants: []
      },
      {
        label: 'cursor',
        mcp_config_path: null,
        supports_mcp: true,
        CURSOR: {
          command: {
            base: 'cursor-agent',
            params: ['-p', '--output-format=stream-json', '--force']
          }
        },
        variants: []
      }
    ];
  }

  // Helper method to determine MCP support based on executor type
  private getSupportsMapForProfile(label: string): boolean {
    // Based on Rust's implementation - executors with default_mcp_config_path support MCP
    const mcpSupportedExecutors = [
      'claude-code',
      'amp',
      'gemini',
      'codex',
      'opencode',
      'cursor'
    ];
    return mcpSupportedExecutors.includes(label);
  }

  // Clear cache when profiles are updated externally
  clearCache(): void {
    this.profilesCache = null;
  }
}
