import { ProcessManager } from '../../../services/src/services/process/processManager';
import { CommandBuilder } from '../command';
import { logger } from '../../../utils/src/logger';
import { MsgStore } from '../../../utils/src/msgStore';
import { PlainTextProcessor, IEntryIndexProvider, EntryIndexProvider } from '../logs';
import { normalizeStderrLogs } from '../logs/stderrProcessor';

/**
 * Opencode executor - equivalent to Rust's Opencode executor
 */
export class Opencode {
  constructor(
    private command: CommandBuilder,
    private appendPrompt?: string
  ) {}

  /**
   * Spawn initial execution (matches Rust Opencode::spawn)
   */
  async spawn(currentDir: string, prompt: string): Promise<ProcessManager> {
    const opencodeCommand = this.command.buildInitial();
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Opencode.spawn called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Command: ${opencodeCommand}`);
    logger.info(`   - Combined prompt length: ${combinedPrompt.length} chars`);
    
    const processManager = new ProcessManager();
    
    // Set environment variables
    process.env.NODE_NO_WARNINGS = '1';
    
    await processManager.spawn(opencodeCommand, currentDir, combinedPrompt);
    
    // Note: Session ID extraction would need a msgStore which isn't available in ProcessManager
    // This would be handled externally when normalizing logs
    
    logger.info(`✅ Opencode ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Spawn follow-up execution (matches Rust Opencode::spawn_follow_up)
   */
  async spawnFollowUp(currentDir: string, prompt: string, sessionId: string): Promise<ProcessManager> {
    const opencodeCommand = this.command.buildFollowUp(['--session', sessionId]);
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Opencode.spawnFollowUp called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Session ID: ${sessionId}`);
    logger.info(`   - Command: ${opencodeCommand}`);
    
    const processManager = new ProcessManager();
    
    // Set environment variables
    process.env.NODE_NO_WARNINGS = '1';
    
    await processManager.spawn(opencodeCommand, currentDir, combinedPrompt);
    
    logger.info(`✅ Opencode follow-up ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Normalize logs from Opencode output (matches Rust Opencode::normalize_logs)
   */
  normalizeLogs(msgStore: MsgStore, currentDir: string): void {
    logger.info(`[Opencode.normalizeLogs] Starting log normalization for dir: ${currentDir}`);
    
    const entryIndexProvider = EntryIndexProvider.startFrom(msgStore);
    
    // Start session ID extraction
    this.startSessionIdExtraction(msgStore);
    
    // Process stderr logs for error detection and plain text normalization
    this.processOpencodeStderr(msgStore, currentDir, entryIndexProvider);
    
    logger.info(`[Opencode.normalizeLogs] Log normalization setup complete`);
  }

  /**
   * Start monitoring stderr lines for session ID extraction
   */
  private startSessionIdExtraction(msgStore: MsgStore): void {
    msgStore.on('stderr', (line: string) => {
      const sessionId = Opencode.parseSessionIdFromLine(line);
      if (sessionId) {
        logger.info(`[Opencode] Extracted session ID: ${sessionId}`);
        msgStore.pushSessionId(sessionId);
      }
    });
  }

  /**
   * Process Opencode stderr output
   */
  private processOpencodeStderr(msgStore: MsgStore, currentDir: string, entryIndexProvider: EntryIndexProvider): void {
    msgStore.on('stderr', (line: string) => {
      // Filter out noise
      if (Opencode.isNoise(line)) return;
      
      // Check for error lines
      if (Opencode.isErrorLine(line)) {
        logger.error(`[Opencode] Error: ${line}`);
      }
      
      // Process tool calls and messages
      logger.debug(`[Opencode] Stderr: ${line}`);
    });
  }

  /**
   * Combine prompt with append_prompt
   */
  private combinePrompt(prompt: string): string {
    if (this.appendPrompt) {
      return `${prompt}\n\n${this.appendPrompt}`;
    }
    return prompt;
  }

  /** Create normalized entry from content */
  static createNormalizedEntry(content: string, worktreePath: string): any {
    // Check if this is a tool call
    const toolCall = this.parseToolCall(content);
    if (toolCall) {
      return {
        timestamp: null,
        entry_type: {
          ToolUse: {
            tool_name: toolCall.tool.name(),
            action_type: this.determineActionType(toolCall.tool, worktreePath)
          }
        },
        content: this.generateToolContent(toolCall.tool, worktreePath),
        metadata: null
      };
    }

    // Default to assistant message
    return {
      timestamp: null,
      entry_type: 'AssistantMessage',
      content,
      metadata: null
    };
  }

  /** Parse a tool call from a string that starts with | */
  static parseToolCall(line: string): any | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      return null;
    }

    // Remove the leading '|' and trim surrounding whitespace
    const content = trimmed.slice(1).trim();
    if (content.length === 0) {
      return null;
    }

    // First token is the tool name, remainder are arguments
    const parts = content.split(/\s+/);
    const toolName = parts[0]?.toLowerCase();
    if (!toolName) return null;

    // Simplified tool parsing - would need full implementation for production
    return {
      tool: {
        name: () => toolName,
        arguments: () => ({ content: parts.slice(1).join(' ') })
      }
    };
  }

  /** Determine action type for tool usage */
  static determineActionType(tool: any, worktreePath: string): any {
    // Simplified implementation - would need full tool type mapping
    return {
      Other: { description: `Tool: ${tool.name()}` }
    };
  }

  /** Generate concise content for tool usage */
  static generateToolContent(tool: any, worktreePath: string): string {
    return `\`${tool.name()}\``;
  }

  /** Detect message boundaries for tool calls */
  static detectToolCall(lines: string[]): any | null {
    for (let i = 0; i < lines.length; i++) {
      if (this.isToolLine(lines[i])) {
        if (i === 0) {
          return { Split: 1 }; // separate tool call from subsequent content
        } else {
          return { Split: i }; // separate tool call from previous content
        }
      }
    }
    return null;
  }

  /** Check if a line is a valid tool line */
  static isToolLine(line: string): boolean {
    return this.parseToolCall(line) !== null;
  }

  /** Parse session ID from OpenCode log lines */
  static parseSessionIdFromLine(line: string): string | null {
    const sessionIdRegex = /.*\b(id|session|sessionID)=([^ ]+)/;
    const match = line.match(sessionIdRegex);
    return match ? match[2] : null;
  }

  /** Check if a line should be skipped as noise */
  static isNoise(line: string): boolean {
    if (line.length === 0) return true;
    
    const trimmed = line.trim();
    
    // NPM warnings
    if (trimmed.match(/^npm warn .*/)) return true;
    
    // Spinner glyphs
    if (trimmed.length === 1 && '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'.includes(trimmed)) return true;
    
    // Model banner
    if (trimmed.startsWith('@ ')) return true;
    
    // Share link
    if (trimmed.startsWith('~  https://opencode.ai/s/')) return true;
    
    return false;
  }

  /**
   * Check if a line is an error line
   */
  static isErrorLine(line: string): boolean {
    return line.startsWith('!  ');
  }

  /**
   * Create default Opencode executor
   */
  static createDefault(): Opencode {
    const command = CommandBuilder.new('npx -y opencode-ai@latest run')
      .params(['--print-logs']);
    return new Opencode(command);
  }
}
