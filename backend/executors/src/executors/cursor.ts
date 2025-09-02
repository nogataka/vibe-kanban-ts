import { ProcessManager } from '../../../services/src/services/process/processManager';
import { CommandBuilder } from '../command';
import { logger } from '../../../utils/src/logger';
import { MsgStore } from '../../../utils/src/msgStore';
import { EntryIndexProvider } from '../logs';
import { normalizeStderrLogs } from '../logs/stderrProcessor';

/**
 * Cursor executor - equivalent to Rust's Cursor executor
 */
export class Cursor {
  constructor(
    private command: CommandBuilder,
    private appendPrompt?: string
  ) {}

  /**
   * Spawn initial execution (matches Rust Cursor::spawn)
   */
  async spawn(currentDir: string, prompt: string): Promise<ProcessManager> {
    const cursorCommand = this.command.buildInitial();
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Cursor.spawn called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Command: ${cursorCommand}`);
    logger.info(`   - Combined prompt length: ${combinedPrompt.length} chars`);
    
    const processManager = new ProcessManager();
    await processManager.spawn(cursorCommand, currentDir, combinedPrompt);
    
    logger.info(`✅ Cursor ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Spawn follow-up execution (matches Rust Cursor::spawn_follow_up)
   */
  async spawnFollowUp(currentDir: string, prompt: string, sessionId: string): Promise<ProcessManager> {
    const cursorCommand = this.command.buildFollowUp(['--resume', sessionId]);
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Cursor.spawnFollowUp called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Session ID: ${sessionId}`);
    logger.info(`   - Command: ${cursorCommand}`);
    
    const processManager = new ProcessManager();
    await processManager.spawn(cursorCommand, currentDir, combinedPrompt);
    
    logger.info(`✅ Cursor follow-up ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Normalize logs from Cursor output (matches Rust Cursor::normalize_logs)
   */
  normalizeLogs(msgStore: MsgStore, currentDir: string): void {
    logger.info(`[Cursor.normalizeLogs] Starting log normalization for dir: ${currentDir}`);
    
    const entryIndexProvider = EntryIndexProvider.startFrom(msgStore);
    
    // Process stdout logs (Cursor's JSONL output)
    logger.info(`[Cursor.normalizeLogs] Processing Cursor JSONL output`);
    this.processCursorJsonlOutput(msgStore, currentDir, entryIndexProvider);
    
    // Cursor doesn't use stderr for normal operation
    logger.info(`[Cursor.normalizeLogs] Log normalization setup complete`);
  }

  /**
   * Process Cursor JSONL output
   */
  private processCursorJsonlOutput(msgStore: MsgStore, currentDir: string, entryIndexProvider: EntryIndexProvider): void {
    msgStore.on('stdout', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      // Strip Cursor ASCII art banner if present
      const cleanLine = Cursor.stripCursorAsciiBanner(trimmed);
      if (!cleanLine) return;
      
      try {
        const json = JSON.parse(cleanLine);
        // Handle Cursor-specific JSON format
        logger.debug(`[Cursor] Parsed JSON:`, json);
      } catch (error) {
        // Handle as plain text output
        logger.debug(`[Cursor] Plain text output: ${cleanLine}`);
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
   * Strip Cursor ASCII art banner from output
   */
  static stripCursorAsciiBanner(line: string): string {
    // Skip known banner lines
    const bannerPatterns = [
      /^\s*\+i":;;/,
      /^\s*\[\?\+<l,",::;;;I/,
      /^\s*\{\[\]_~iI"":::;;;;II/,
      /↗↗↗↗↗↗↗↗↗↗↗↗↗↗↗↗↗↗↗↗↗/,
      /…  Cursor Agent/
    ];

    for (const pattern of bannerPatterns) {
      if (pattern.test(line)) {
        return '';
      }
    }
    return line;
  }

  /**
   * Create default Cursor executor
   */
  static createDefault(): Cursor {
    const command = CommandBuilder.new('cursor-agent')
      .params(['-p', '--output-format=stream-json', '--force']);
    return new Cursor(command);
  }
}
