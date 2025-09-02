import * as fs from 'fs/promises';
import * as path from 'path';
import * as TOML from '@ltd/j-toml';
import { logger } from '../../utils/src/logger';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpConfig {
  servers: Record<string, any>;
  servers_path: string[];
  template: any;
  vibe_kanban: any;
  is_toml_config: boolean;
}

export class McpConfigError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

export class McpConfigManager {
  /**
   * Create a new MCP configuration
   */
  static create(
    serversPath: string[],
    template: any,
    vibeKanban: any,
    isTomlConfig: boolean = false
  ): McpConfig {
    return {
      servers: {},
      servers_path: serversPath,
      template,
      vibe_kanban: vibeKanban,
      is_toml_config: isTomlConfig
    };
  }

  /**
   * Read an agent's external config file (JSON or TOML) and normalize it to JSON
   */
  static async readAgentConfig(configPath: string, mcpConfig: McpConfig): Promise<any> {
    try {
      const fileContent = await fs.readFile(configPath, 'utf-8');
      
      if (mcpConfig.is_toml_config) {
        // Parse TOML then convert to JSON
        if (fileContent.trim() === '') {
          return {};
        }
        
        try {
          return TOML.parse(fileContent);
        } catch (error) {
          throw new McpConfigError(`Failed to parse TOML config: ${error}`, 'TOML_PARSE_ERROR');
        }
      } else {
        // Parse JSON
        try {
          return JSON.parse(fileContent);
        } catch (error) {
          throw new McpConfigError(`Failed to parse JSON config: ${error}`, 'JSON_PARSE_ERROR');
        }
      }
    } catch (error) {
      if (error instanceof McpConfigError) {
        throw error;
      }
      
      // File doesn't exist or can't be read, return template
      logger.debug(`Config file ${configPath} not found, using template`);
      return mcpConfig.template;
    }
  }

  /**
   * Write an agent's external config back to disk in the agent's format
   */
  static async writeAgentConfig(
    configPath: string,
    mcpConfig: McpConfig,
    config: any
  ): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(configPath);
      await fs.mkdir(dir, { recursive: true });

      let content: string;
      
      if (mcpConfig.is_toml_config) {
        // Convert to TOML
        try {
          content = TOML.stringify(config, { newline: '\n', indent: '  ' });
        } catch (error) {
          throw new McpConfigError(`Failed to stringify TOML config: ${error}`, 'TOML_STRINGIFY_ERROR');
        }
      } else {
        // Convert to JSON
        content = JSON.stringify(config, null, 2);
      }

      await fs.writeFile(configPath, content, 'utf-8');
      logger.debug(`Written config to ${configPath}`);
    } catch (error) {
      if (error instanceof McpConfigError) {
        throw error;
      }
      throw new McpConfigError(`Failed to write config file: ${error}`, 'WRITE_ERROR');
    }
  }

  /**
   * Get servers from a config using the specified path
   */
  static getServers(config: any, serversPath: string[]): Record<string, any> {
    let current = config;
    
    for (const pathPart of serversPath) {
      if (current && typeof current === 'object' && pathPart in current) {
        current = current[pathPart];
      } else {
        return {};
      }
    }
    
    return current || {};
  }

  /**
   * Set servers in a config using the specified path
   */
  static setServers(config: any, serversPath: string[], servers: Record<string, any>): any {
    const result = JSON.parse(JSON.stringify(config)); // Deep clone
    let current = result;
    
    // Navigate to the parent of the servers object
    for (let i = 0; i < serversPath.length - 1; i++) {
      const pathPart = serversPath[i];
      if (!current[pathPart] || typeof current[pathPart] !== 'object') {
        current[pathPart] = {};
      }
      current = current[pathPart];
    }
    
    // Set the servers
    const lastPathPart = serversPath[serversPath.length - 1];
    current[lastPathPart] = servers;
    
    return result;
  }

  /**
   * Add a server to the configuration
   */
  static addServer(
    config: any,
    serversPath: string[],
    serverName: string,
    serverConfig: McpServerConfig
  ): any {
    const servers = this.getServers(config, serversPath);
    servers[serverName] = serverConfig;
    return this.setServers(config, serversPath, servers);
  }

  /**
   * Remove a server from the configuration
   */
  static removeServer(config: any, serversPath: string[], serverName: string): any {
    const servers = this.getServers(config, serversPath);
    delete servers[serverName];
    return this.setServers(config, serversPath, servers);
  }

  /**
   * Get the Vibe Kanban MCP server configuration
   */
  static getVibeKanbanConfig(mcpConfig: McpConfig): McpServerConfig {
    return {
      command: 'npx',
      args: ['-y', 'vibe-kanban', '--mcp'],
      env: {},
      ...mcpConfig.vibe_kanban
    };
  }

  /**
   * Update MCP servers in a configuration file
   */
  static async updateMcpServers(
    configPath: string,
    mcpConfig: McpConfig,
    servers: Record<string, McpServerConfig>
  ): Promise<void> {
    try {
      // Read current config
      const currentConfig = await this.readAgentConfig(configPath, mcpConfig);
      
      // Update servers
      const updatedConfig = this.setServers(currentConfig, mcpConfig.servers_path, servers);
      
      // Write back
      await this.writeAgentConfig(configPath, mcpConfig, updatedConfig);
      
      logger.info(`Updated MCP servers in ${configPath}`);
    } catch (error) {
      logger.error(`Failed to update MCP servers in ${configPath}:`, error);
      throw error;
    }
  }

  /**
   * Ensure Vibe Kanban MCP server is configured
   */
  static async ensureVibeKanbanMcp(configPath: string, mcpConfig: McpConfig): Promise<void> {
    try {
      const currentConfig = await this.readAgentConfig(configPath, mcpConfig);
      const servers = this.getServers(currentConfig, mcpConfig.servers_path);
      
      // Check if vibe-kanban server already exists
      if (!servers['vibe-kanban']) {
        const vibeKanbanConfig = this.getVibeKanbanConfig(mcpConfig);
        const updatedServers = {
          ...servers,
          'vibe-kanban': vibeKanbanConfig
        };
        
        const updatedConfig = this.setServers(currentConfig, mcpConfig.servers_path, updatedServers);
        await this.writeAgentConfig(configPath, mcpConfig, updatedConfig);
        
        logger.info(`Added Vibe Kanban MCP server to ${configPath}`);
      } else {
        logger.debug(`Vibe Kanban MCP server already configured in ${configPath}`);
      }
    } catch (error) {
      logger.error(`Failed to ensure Vibe Kanban MCP in ${configPath}:`, error);
      throw error;
    }
  }

  /**
   * Validate MCP configuration
   */
  static validateMcpConfig(servers: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (!serverConfig) {
        errors.push(`Server ${serverName} has no configuration`);
        continue;
      }
      
      if (typeof serverConfig !== 'object') {
        errors.push(`Server ${serverName} configuration must be an object`);
        continue;
      }
      
      // Check required fields based on common MCP server patterns
      if (!serverConfig.command && !serverConfig.args) {
        errors.push(`Server ${serverName} must have either 'command' or 'args' specified`);
      }
      
      if (serverConfig.args && !Array.isArray(serverConfig.args)) {
        errors.push(`Server ${serverName} 'args' must be an array`);
      }
      
      if (serverConfig.env && typeof serverConfig.env !== 'object') {
        errors.push(`Server ${serverName} 'env' must be an object`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Create default MCP configurations for different agents
   */
  static getDefaultMcpConfigs(): Record<string, McpConfig> {
    return {
      'claude-code': this.create(
        ['mcpServers'],
        { mcpServers: {} },
        {
          command: 'npx',
          args: ['-y', 'vibe-kanban', '--mcp'],
          env: {}
        },
        false
      ),
      'cursor': this.create(
        ['mcp', 'servers'],
        { mcp: { servers: {} } },
        {
          command: 'npx',
          args: ['-y', 'vibe-kanban', '--mcp'],
          env: {}
        },
        false
      ),
      'gemini': this.create(
        ['servers'],
        { servers: {} },
        {
          command: 'npx',
          args: ['-y', 'vibe-kanban', '--mcp'],
          env: {}
        },
        true
      )
    };
  }

  /**
   * Get MCP config path for a specific agent
   */
  static getAgentMcpConfigPath(agentType: string): string | null {
    const homeDir = require('os').homedir();
    
    switch (agentType.toLowerCase()) {
      case 'claude-code':
      case 'claude_code':
        return path.join(homeDir, '.config', 'claude', 'config.json');
      
      case 'cursor':
        return path.join(homeDir, '.cursor', 'config.json');
        
      case 'gemini':
        return path.join(homeDir, '.config', 'gemini', 'config.toml');
        
      default:
        return null;
    }
  }

  /**
   * Check if a config file exists
   */
  static async configExists(configPath: string): Promise<boolean> {
    try {
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Backup a configuration file
   */
  static async backupConfig(configPath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.backup-${timestamp}`;
    
    try {
      await fs.copyFile(configPath, backupPath);
      logger.info(`Backed up config to ${backupPath}`);
      return backupPath;
    } catch (error) {
      throw new McpConfigError(`Failed to backup config: ${error}`, 'BACKUP_ERROR');
    }
  }
}
