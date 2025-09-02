import { ProcessManager } from '../../../services/src/services/process/processManager';
import { CommandBuilder } from '../command';
import { logger } from '../../../utils/src/logger';
import { MsgStore } from '../../../utils/src/msgStore';
import { ClaudeLogProcessor, HistoryStrategy, EntryIndexProvider } from '../logs';
import { normalizeStderrLogs } from '../logs/stderrProcessor';

/**
 * AMP executor - equivalent to Rust's Amp executor
 */
export class Amp {
  constructor(
    private command: CommandBuilder,
    private appendPrompt?: string
  ) {}

  /**
   * Spawn initial execution (matches Rust Amp::spawn)
   */
  async spawn(currentDir: string, prompt: string): Promise<ProcessManager> {
    const ampCommand = this.command.buildInitial();
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Amp.spawn called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Command: ${ampCommand}`);
    logger.info(`   - Combined prompt length: ${combinedPrompt.length} chars`);
    
    const processManager = new ProcessManager();
    await processManager.spawn(ampCommand, currentDir, combinedPrompt);
    
    logger.info(`✅ Amp ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Spawn follow-up execution (matches Rust Amp::spawn_follow_up)
   */
  async spawnFollowUp(currentDir: string, prompt: string, sessionId: string): Promise<ProcessManager> {
    const ampCommand = this.command.buildFollowUp(['threads', 'continue', sessionId]);
    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 Amp.spawnFollowUp called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Session ID: ${sessionId}`);
    logger.info(`   - Command: ${ampCommand}`);
    
    const processManager = new ProcessManager();
    await processManager.spawn(ampCommand, currentDir, combinedPrompt);
    
    logger.info(`✅ Amp follow-up ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Normalize logs from Amp output (matches Rust Amp::normalize_logs)
   */
  normalizeLogs(msgStore: MsgStore, currentDir: string): void {
    logger.info(`[Amp.normalizeLogs] Starting log normalization for dir: ${currentDir}`);
    
    const entryIndexProvider = EntryIndexProvider.startFrom(msgStore);
    
    // Process stdout logs (Amp's stream JSON output) using Claude's log processor with AmpResume strategy
    logger.info(`[Amp.normalizeLogs] Starting ClaudeLogProcessor.processLogs with AmpResume strategy`);
    ClaudeLogProcessor.processLogs(
      msgStore,
      currentDir,
      entryIndexProvider,
      HistoryStrategy.AmpResume
    ).catch(error => {
      logger.error('[Amp.normalizeLogs] Failed to process Amp logs:', error);
    });

    // Process stderr logs using the standard stderr processor
    logger.info(`[Amp.normalizeLogs] Starting normalizeStderrLogs`);
    normalizeStderrLogs(msgStore, entryIndexProvider);
    
    logger.info(`[Amp.normalizeLogs] Log normalization setup complete`);
  }

  /**
   * Combine prompt with append_prompt (matches Rust utils::text::combine_prompt)
   */
  private combinePrompt(prompt: string): string {
    if (this.appendPrompt) {
      return `${prompt}\n\n${this.appendPrompt}`;
    }
    return prompt;
  }

  /**
   * Create default Amp executor
   */
  static createDefault(): Amp {
    const command = CommandBuilder.new('npx -y @sourcegraph/amp@latest')
      .params(['--execute', '--stream-json', '--dangerously-allow-all']);
    return new Amp(command);
  }
}
