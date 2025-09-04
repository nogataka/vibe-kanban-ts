import { ProcessManager } from '../../../services/src/services/process/processManager';
import * as fs from 'fs';
import * as path from 'path';
import { CommandBuilder } from '../command';
import { logger } from '../../../utils/src/logger';
import { MsgStore } from '../../../utils/src/msgStore';
import { PlainTextProcessor, IEntryIndexProvider, EntryIndexProvider } from '../logs';
import { normalizeStderrLogs } from '../logs/stderrProcessor';

/**
 * Gemini executor - equivalent to Rust's Gemini executor
 */
export class Gemini {
  constructor(
    private command: CommandBuilder,
    private appendPrompt?: string
  ) {}

  /**
   * Spawn initial execution (matches Rust Gemini::spawn)
   */
  async spawn(currentDir: string, prompt: string): Promise<ProcessManager> {
    const geminiCommand = this.command.buildInitial();
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Gemini.spawn called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Command: ${geminiCommand}`);
    logger.info(`   - Combined prompt length: ${combinedPrompt.length} chars`);
    
    const processManager = new ProcessManager();
    
    // Set environment variables
    process.env.NODE_NO_WARNINGS = '1';
    
    await processManager.spawn(geminiCommand, currentDir, combinedPrompt);
    
    // Start session recording
    this.recordSession(processManager, currentDir, prompt, false);
    
    logger.info(`✅ Gemini ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Spawn follow-up execution (matches Rust Gemini::spawn_follow_up)
   */
  async spawnFollowUp(currentDir: string, prompt: string, sessionId: string): Promise<ProcessManager> {
    // Build comprehensive prompt with session context
    const followupPrompt = await this.buildFollowupPrompt(currentDir, prompt);
    
    const geminiCommand = this.command.buildFollowUp([]);
    
    logger.info(`🤖 Gemini.spawnFollowUp called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Session ID: ${sessionId}`);
    logger.info(`   - Command: ${geminiCommand}`);
    
    const processManager = new ProcessManager();
    
    // Set environment variables
    process.env.NODE_NO_WARNINGS = '1';
    
    await processManager.spawn(geminiCommand, currentDir, followupPrompt);
    
    // Start session recording (resume existing session)
    this.recordSession(processManager, currentDir, prompt, true);
    
    logger.info(`✅ Gemini follow-up ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Normalize logs from Gemini output (matches Rust Gemini::normalize_logs)
   */
  normalizeLogs(msgStore: MsgStore, currentDir: string): void {
    logger.info(`[Gemini.normalizeLogs] Starting log normalization for dir: ${currentDir}`);
    
    const entryIndexProvider = EntryIndexProvider.startFrom(msgStore);
    
    // Send session ID to msg_store to enable follow-ups (use worktree directory name)
    const sessionId = path.basename(currentDir);
    msgStore.pushSessionId(sessionId);
    
    // Setup session recording
    const sessionFilePath = this.getSessionFilePath(currentDir);
    const sessionsDir = path.dirname(sessionFilePath);
    fs.mkdirSync(sessionsDir, { recursive: true });
    
    // Record stdout to session file
    msgStore.on('stdout', (content: string) => {
      fs.appendFileSync(sessionFilePath, content);
    });
    
    // Process stdout logs with plain text normalization and Gemini-specific formatting
    logger.info(`[Gemini.normalizeLogs] Starting PlainTextProcessor.processLogs`);
    PlainTextProcessor.processLogs(
      msgStore,
      currentDir,
      entryIndexProvider,
      'gemini',
      Gemini.formatStdoutChunk
    ).catch(error => {
      logger.error('[Gemini.normalizeLogs] Failed to process Gemini logs:', error);
    });

    // Process stderr logs using the standard stderr processor
    logger.info(`[Gemini.normalizeLogs] Starting normalizeStderrLogs`);
    normalizeStderrLogs(msgStore, entryIndexProvider);
    
    logger.info(`[Gemini.normalizeLogs] Log normalization setup complete`);
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
   * Record session for follow-up capability
   */
  private recordSession(processManager: ProcessManager, currentDir: string, prompt: string, resumeSession: boolean): void {
    const sessionFilePath = this.getSessionFilePath(currentDir);
    const sessionsDir = path.dirname(sessionFilePath);
    
    // Ensure sessions directory exists
    fs.mkdirSync(sessionsDir, { recursive: true });
    
    // Note: In the TypeScript version, msgStore is managed separately
    // by the DeploymentService, not attached to processManager
    // The session recording happens through the normalizeLogs method
    
    logger.info(`[Gemini] Recording session to: ${sessionFilePath}`);
  }

  /**
   * Build follow-up prompt with session context
   */
  private async buildFollowupPrompt(currentDir: string, prompt: string): Promise<string> {
    const sessionFilePath = this.getSessionFilePath(currentDir);
    
    try {
      const sessionContext = await fs.promises.readFile(sessionFilePath, 'utf8');
      
      return `RESUME CONTEXT FOR CONTINUING TASK

=== EXECUTION HISTORY ===
The following is the conversation history from this session:
${sessionContext}

=== CURRENT REQUEST ===
${prompt}

=== INSTRUCTIONS ===
You are continuing work on the above task. The execution history shows the previous conversation in this session. Please continue from where the previous execution left off, taking into account all the context provided above.${this.appendPrompt || ''}`;
    } catch {
      throw new Error(`No existing Gemini session found for this worktree. Session file not found at ${sessionFilePath}`);
    }
  }

  private getSessionFilePath(currentDir: string): string {
    const fileName = path.basename(currentDir);
    const baseDir = this.getSessionsBaseDir();
    return path.join(baseDir, fileName);
  }

  private getSessionsBaseDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || process.env.TMPDIR || '/tmp';
    return path.join(home, '.vibe-kanban', 'gemini_sessions');
  }

  /**
   * Make Gemini output more readable by inserting line breaks where periods are directly followed by capital letters
   */
  static formatStdoutChunk(content: string, accumulatedMessage: string): string {
    let result = '';
    const chars = Array.from(content);

    // Check for cross-chunk boundary: previous chunk ended with period, current starts with capital
    if (accumulatedMessage.length > 0 && content.length > 0) {
      const endsWithPeriod = accumulatedMessage.endsWith('.');
      const startsWithCapital = chars[0] && /^[A-Z]$/.test(chars[0]);
      
      if (endsWithPeriod && startsWithCapital) {
        result += '\n';
      }
    }

    // Handle intra-chunk period-to-capital transitions
    for (let i = 0; i < chars.length; i++) {
      result += chars[i];
      
      // Check if current char is '.' and next char is uppercase letter (no space between)
      if (chars[i] === '.' && i + 1 < chars.length) {
        const nextChar = chars[i + 1];
        if (/^[A-Z]$/.test(nextChar)) {
          result += '\n';
        }
      }
    }

    return result;
  }

  /**
   * Create default Gemini executor
   */
  static createDefault(): Gemini {
    const command = CommandBuilder.new('npx -y @google/gemini-cli@latest')
      .params(['--yolo']);
    return new Gemini(command);
  }
}
