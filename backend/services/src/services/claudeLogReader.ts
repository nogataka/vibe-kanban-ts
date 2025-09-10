import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../../utils/src/logger';

export interface ClaudeToolUse {
  id: string;
  name: string;
  input: any;
}

export interface ClaudeToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  tool_use?: ClaudeToolUse;
  tool_result?: ClaudeToolResult;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ClaudeContentBlock[];
  timestamp?: string;
  type?: string;
}

export interface ClaudeSessionData {
  messages: ClaudeMessage[];
  sessionId: string;
  worktreePath: string;
  filePath: string;
}

export class ClaudeLogReader {
  private claudeProjectsDir: string;

  constructor() {
    // ~/.claude/projects directory
    this.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  }

  /**
   * Extract the worktree path from task attempt directory
   */
  private extractWorktreePath(attemptDir: string): string {
    // STEP1: Add /private prefix if not present
    let pathToTransform = attemptDir;
    if (!attemptDir.startsWith('/private')) {
      pathToTransform = '/private' + attemptDir;
    }
    
    // STEP2: Replace all slashes with hyphens (including the leading slash)
    const transformed = pathToTransform.replace(/\//g, '-');
    
    logger.info(`Transformed path: ${attemptDir} -> ${transformed}`);
    return transformed;
  }

  /**
   * Find the latest session file for a given worktree
   */
  private async findLatestSessionFile(worktreePath: string): Promise<string | null> {
    try {
      const projectDir = path.join(this.claudeProjectsDir, worktreePath);
      
      // Check if directory exists
      try {
        await fs.access(projectDir);
      } catch {
        logger.warn(`Claude project directory not found: ${projectDir}`);
        return null;
      }

      // List all .jsonl files
      const files = await fs.readdir(projectDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      
      if (jsonlFiles.length === 0) {
        logger.warn(`No session files found in: ${projectDir}`);
        return null;
      }

      // Get file stats and sort by modification time
      const fileStats = await Promise.all(
        jsonlFiles.map(async (file) => {
          const filePath = path.join(projectDir, file);
          const stat = await fs.stat(filePath);
          return { file, mtime: stat.mtime.getTime() };
        })
      );

      // Sort by modification time (newest first)
      fileStats.sort((a, b) => b.mtime - a.mtime);
      
      // Return the newest file
      return path.join(projectDir, fileStats[0].file);
    } catch (error) {
      logger.error('Error finding session file:', error);
      return null;
    }
  }

  /**
   * Parse a JSONL file containing Claude messages
   */
  private async parseJsonlFile(filePath: string): Promise<ClaudeMessage[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      const messages: ClaudeMessage[] = [];
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          
          // Handle different message formats
          // Format 1: Direct message format (role and content at top level)
          if (data.role && data.content !== undefined) {
            messages.push({
              role: data.role,
              content: data.content,
              timestamp: data.timestamp || new Date().toISOString(),
              type: data.type
            });
          }
          // Format 2: Wrapped message format (message field contains role and content)
          else if (data.message && data.message.role && data.message.content !== undefined) {
            // Log the structure for debugging
            if (Array.isArray(data.message.content) && data.message.content.length > 0) {
              // Check if first element has tool_use or tool_result
              const firstContent = data.message.content[0];
              if (firstContent.type === 'tool_use' || firstContent.type === 'tool_result') {
                logger.info(`Found ${firstContent.type} in message content`);
              }
            }
            
            messages.push({
              role: data.message.role,
              content: data.message.content,
              timestamp: data.timestamp || new Date().toISOString(),
              type: data.type || data.message.type
            });
          }
          // Format 3: Tool result format (special case for user messages with tool results)
          else if (data.type === 'user' && data.message && data.message.content) {
            messages.push({
              role: 'user',
              content: data.message.content,
              timestamp: data.timestamp || new Date().toISOString(),
              type: data.type
            });
          }
        } catch (parseError) {
          logger.warn(`Failed to parse line in JSONL file: ${parseError}`);
          // Continue with next line
        }
      }
      
      return messages;
    } catch (error) {
      logger.error(`Error reading JSONL file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Read Claude session logs for a task attempt
   */
  async readSessionLogs(attemptDir: string, sessionId?: string): Promise<ClaudeSessionData | null> {
    try {
      // Extract worktree path from attempt directory
      const worktreePath = this.extractWorktreePath(attemptDir);
      logger.info(`Looking for Claude logs in worktree: ${worktreePath}`);
      
      const projectDir = path.join(this.claudeProjectsDir, worktreePath);
      
      // Check if the Claude project directory exists
      try {
        await fs.access(projectDir);
      } catch {
        const errorMsg = `Claude project directory not found: ${projectDir}. This may indicate that no Claude sessions have been created for this worktree.`;
        logger.warn(errorMsg);
        return null;
      }
      
      let filePath: string | null = null;
      
      if (sessionId) {
        // If session ID is provided, use it directly
        filePath = path.join(projectDir, `${sessionId}.jsonl`);
        
        // Check if file exists
        try {
          await fs.access(filePath);
        } catch {
          const errorMsg = `Session file not found: ${filePath}`;
          logger.error(errorMsg);
          throw new Error(errorMsg);
        }
      } else {
        // Find the latest session file
        filePath = await this.findLatestSessionFile(worktreePath);
        
        if (!filePath) {
          const errorMsg = `No session files found in directory: ${projectDir}`;
          logger.warn(errorMsg);
          return null;
        }
      }
      
      logger.info(`Reading Claude session file: ${filePath}`);
      
      // Parse the JSONL file
      const messages = await this.parseJsonlFile(filePath);
      
      if (messages.length === 0) {
        logger.warn(`Session file is empty or contains no valid messages: ${filePath}`);
      }
      
      // Extract session ID from filename
      const fileName = path.basename(filePath, '.jsonl');
      
      return {
        messages,
        sessionId: fileName,
        worktreePath,
        filePath
      };
    } catch (error) {
      logger.error('Error reading Claude session logs:', error);
      // Re-throw the error to be handled by the API endpoint
      throw error;
    }
  }

  /**
   * List available session files for a worktree
   */
  async listSessions(attemptDir: string): Promise<string[]> {
    try {
      const worktreePath = this.extractWorktreePath(attemptDir);
      const projectDir = path.join(this.claudeProjectsDir, worktreePath);
      
      logger.info(`Listing sessions in: ${projectDir}`);
      
      // Check if directory exists
      try {
        await fs.access(projectDir);
      } catch {
        logger.info(`Claude project directory does not exist: ${projectDir}`);
        // Return empty array instead of throwing error - this is expected for attempts without Claude sessions
        return [];
      }

      // List all .jsonl files
      const files = await fs.readdir(projectDir);
      const jsonlFiles = files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => path.basename(f, '.jsonl'));
      
      logger.info(`Found ${jsonlFiles.length} session(s) in ${projectDir}`);
      return jsonlFiles;
    } catch (error) {
      logger.error('Error listing sessions:', error);
      // Re-throw the error to be handled by the API endpoint
      throw error;
    }
  }
}