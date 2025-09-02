// Executors module - equivalent to Rust's executors/src/executors/mod.rs
export * from './amp';
export * from './claude';
export * from './codex';
export * from './cursor';
export * from './gemini';
export * from './opencode';

// Types and interfaces corresponding to Rust's enum and trait definitions  
export class ExecutorError extends Error {
  constructor(message: string, public errorType?: string) {
    super(message);
    this.name = 'ExecutorError';
  }

  static FollowUpNotSupported(message: string): ExecutorError {
    return new ExecutorError(message, 'FollowUpNotSupported');
  }

  static SpawnError(message: string): ExecutorError {
    return new ExecutorError(message, 'SpawnError');
  }

  static UnknownExecutorType(message: string): ExecutorError {
    return new ExecutorError(message, 'UnknownExecutorType');
  }
}

export type CodingAgentType = 'CLAUDE_CODE' | 'AMP' | 'GEMINI' | 'CODEX' | 'OPENCODE' | 'CURSOR';

export interface CodingAgentInterface {
  type: CodingAgentType;
  supportsMcp(): boolean;
  getMcpConfig(): McpConfig;
  getDefaultMcpConfigPath(): string | null;
}

// CodingAgent enum equivalent
export class CodingAgent implements CodingAgentInterface, StandardCodingAgentExecutor {
  constructor(public type: CodingAgentType) {}

  static fromProfileVariantLabel(profileVariantLabel: ProfileVariantLabel): CodingAgent {
    // Simplified implementation - in full version would load from ProfileConfigs
    const profile = profileVariantLabel.profile;
    
    switch (profile) {
      case 'claude-code':
        return new CodingAgent('CLAUDE_CODE');
      case 'gemini':
        return new CodingAgent('GEMINI');
      case 'codex':
        return new CodingAgent('CODEX');
      case 'amp':
        return new CodingAgent('AMP');
      case 'opencode':
        return new CodingAgent('OPENCODE');
      case 'cursor':
        return new CodingAgent('CURSOR');
      default:
        return new CodingAgent('CLAUDE_CODE');
    }
  }

  supportsMcp(): boolean {
    return this.getDefaultMcpConfigPath() !== null;
  }

  getMcpConfig(): McpConfig {
    // Implementation based on Rust version
    switch (this.type) {
      case 'CODEX':
        return {
          paths: ['mcp_servers'],
          template: { mcp_servers: {} },
          serverConfig: {
            command: 'npx',
            args: ['-y', 'vibe-kanban', '--mcp']
          },
          enabledByDefault: true
        };
      case 'AMP':
        return {
          paths: ['amp.mcpServers'],
          template: { 'amp.mcpServers': {} },
          serverConfig: {
            command: 'npx',
            args: ['-y', 'vibe-kanban', '--mcp']
          },
          enabledByDefault: false
        };
      case 'OPENCODE':
        return {
          paths: ['mcp'],
          template: {
            mcp: {},
            $schema: 'https://opencode.ai/config.json'
          },
          serverConfig: {
            type: 'local',
            command: ['npx', '-y', 'vibe-kanban', '--mcp'],
            enabled: true
          },
          enabledByDefault: false
        };
      default:
        return {
          paths: ['mcpServers'],
          template: { mcpServers: {} },
          serverConfig: {
            command: 'npx',
            args: ['-y', 'vibe-kanban', '--mcp']
          },
          enabledByDefault: false
        };
    }
  }

  getDefaultMcpConfigPath(): string | null {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) return null;

    switch (this.type) {
      case 'CLAUDE_CODE':
        return `${home}/.claude.json`;
      case 'OPENCODE':
        return `${home}/.config/opencode/opencode.json`; // Simplified
      case 'CODEX':
        return `${home}/.codex/config.toml`;
      case 'AMP':
        return `${home}/.config/amp/settings.json`; // Simplified
      case 'GEMINI':
        return `${home}/.gemini/settings.json`;
      case 'CURSOR':
        return `${home}/.cursor/mcp.json`;
      default:
        return null;
    }
  }

  async spawn(currentDir: string, prompt: string): Promise<any> {
    // Placeholder - would implement actual executor spawning
    return null;
  }

  async spawnFollowUp(currentDir: string, prompt: string, sessionId: string): Promise<any> {
    // Placeholder - would implement actual follow-up spawning
    return null;
  }

  normalizeLogs(rawLogsEventStore: any, worktreePath: string): void {
    // Placeholder - would implement log normalization
  }
}

export interface McpConfig {
  paths: string[];
  template: Record<string, any>;
  serverConfig: Record<string, any>;
  enabledByDefault: boolean;
}

export interface StandardCodingAgentExecutor {
  spawn(currentDir: string, prompt: string): Promise<any>;
  spawnFollowUp(currentDir: string, prompt: string, sessionId: string): Promise<any>;
  normalizeLogs(rawLogsEventStore: any, worktreePath: string): void;
}

export interface ProfileVariantLabel {
  profile: string;
  variant?: string;
}

