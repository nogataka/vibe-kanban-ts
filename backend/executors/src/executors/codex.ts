import { ProcessManager } from '../../../services/src/services/process/processManager';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CommandBuilder } from '../command';
import { logger } from '../../../utils/src/logger';
import { MsgStore } from '../../../utils/src/msgStore';
import { EntryIndexProvider } from '../logs';

/**
 * Codex executor - equivalent to Rust's Codex executor
 */
export class Codex {
  constructor(
    private command: CommandBuilder,
    private appendPrompt?: string
  ) {}

  /**
   * Spawn initial execution (matches Rust Codex::spawn)
   */
  async spawn(currentDir: string, prompt: string): Promise<ProcessManager> {
    const codexCommand = this.command.buildInitial();
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Codex.spawn called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Command: ${codexCommand}`);
    logger.info(`   - Combined prompt length: ${combinedPrompt.length} chars`);
    
    const processManager = new ProcessManager();
    
    // Set environment variables like Rust version
    process.env.NODE_NO_WARNINGS = '1';
    process.env.RUST_LOG = 'info';
    
    await processManager.spawn(codexCommand, currentDir, combinedPrompt);
    
    // Note: Session ID extraction would need a msgStore which isn't available in ProcessManager
    // This would be handled externally when normalizing logs
    
    logger.info(`✅ Codex ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Spawn follow-up execution (matches Rust Codex::spawn_follow_up)
   */
  async spawnFollowUp(currentDir: string, prompt: string, sessionId: string): Promise<ProcessManager> {
    // Find the rollout file for the given session_id
    const rolloutFilePath = await this.findRolloutFilePath(sessionId);
    
    const codexCommand = this.command.buildFollowUp([
      '-c',
      `experimental_resume=${rolloutFilePath}`
    ]);
    
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Codex.spawnFollowUp called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Session ID: ${sessionId}`);
    logger.info(`   - Rollout file: ${rolloutFilePath}`);
    logger.info(`   - Command: ${codexCommand}`);
    
    const processManager = new ProcessManager();
    
    // Set environment variables like Rust version
    process.env.NODE_NO_WARNINGS = '1';
    process.env.RUST_LOG = 'info';
    
    await processManager.spawn(codexCommand, currentDir, combinedPrompt);
    
    logger.info(`✅ Codex follow-up ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Normalize logs from Codex output (matches Rust Codex::normalize_logs)
   * Processes JSONL format output from Codex
   */
  normalizeLogs(msgStore: MsgStore, currentDir: string): void {
    logger.info(`[Codex.normalizeLogs] Starting log normalization for dir: ${currentDir}`);
    
    const entryIndexProvider = EntryIndexProvider.startFrom(msgStore);
    
    // Process stderr logs for session extraction only
    this.startSessionIdExtraction(msgStore);
    
    // Process stdout logs (Codex's JSONL output) - simplified version
    logger.info(`[Codex.normalizeLogs] Processing Codex JSONL output`);
    this.processCodexJsonlOutput(msgStore, currentDir, entryIndexProvider);
    
    logger.info(`[Codex.normalizeLogs] Log normalization setup complete`);
  }

  /**
   * Start monitoring stderr lines for session ID extraction
   */
  private startSessionIdExtraction(msgStore: MsgStore): void {
    msgStore.on('stderr', (line: string) => {
      const sessionId = Codex.extractSessionIdFromLine(line);
      if (sessionId) {
        logger.info(`[Codex] Extracted session ID: ${sessionId}`);
        msgStore.pushSessionId(sessionId);
      }
    });
  }

  /**
   * Process Codex JSONL output (simplified version)
   */
  private processCodexJsonlOutput(msgStore: MsgStore, currentDir: string, entryIndexProvider: EntryIndexProvider): void {
    msgStore.on('stdout', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      try {
        const json = JSON.parse(trimmed);
        
        // Handle different message types based on Rust implementation
        if (json.msg) {
          const msgType = json.msg.type;
          
          switch (msgType) {
            case 'agent_message':
              logger.debug(`[Codex] Agent message: ${json.msg.message}`);
              break;
            case 'agent_reasoning':
              logger.debug(`[Codex] Agent reasoning: ${json.msg.text?.substring(0, 100)}...`);
              break;
            case 'error':
              logger.error(`[Codex] Error: ${json.msg.message || 'Unknown error'}`);
              break;
            case 'exec_command_begin':
              logger.debug(`[Codex] Command begin: ${json.msg.command?.join(' ')}`);
              break;
            case 'exec_command_end':
              logger.debug(`[Codex] Command end: exit_code=${json.msg.exit_code}`);
              break;
            default:
              logger.debug(`[Codex] Unhandled message type: ${msgType}`);
          }
        }
      } catch (error) {
        // Handle malformed JSON as raw output
        logger.debug(`[Codex] Raw output: ${trimmed}`);
      }
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

  /**
   * Find codex rollout file path for given session_id
   */
  private async findRolloutFilePath(sessionId: string): Promise<string> {
    const homeDir = os.homedir();
    const sessionsDir = path.join(homeDir, '.codex', 'sessions');
    
    return await this.scanDirectoryForRollout(sessionsDir, sessionId);
  }

  /**
   * Recursively scan directory for rollout files matching the session_id
   */
  private async scanDirectoryForRollout(dir: string, sessionId: string): Promise<string> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          try {
            const found = await this.scanDirectoryForRollout(fullPath, sessionId);
            return found;
          } catch {
            // Continue searching
          }
        } else if (entry.isFile()) {
          // Pattern: rollout-{YYYY}-{MM}-{DD}T{HH}-{mm}-{ss}-{session_id}.jsonl
          if (entry.name.includes(sessionId) && 
              entry.name.startsWith('rollout-') && 
              entry.name.endsWith('.jsonl')) {
            return fullPath;
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to scan directory ${dir}:`, error);
    }
    
    throw new Error(`Could not find rollout file for session_id: ${sessionId}`);
  }

  /**
   * Extract session ID from codex stderr output
   */
  static extractSessionIdFromLine(line: string): string | null {
    const sessionIdRegex = /session_id:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
    const match = line.match(sessionIdRegex);
    return match ? match[1] : null;
  }

  /**
   * Create default Codex executor
   */
  static createDefault(): Codex {
    const command = CommandBuilder.new('npx -y @openai/codex exec')
      .params(['--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check']);
    return new Codex(command);
  }
}
