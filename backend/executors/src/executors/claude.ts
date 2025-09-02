import { ProcessManager } from '../../../services/src/services/process/processManager';
import { CommandBuilder } from '../command';
import { logger } from '../../../utils/src/logger';
import { MsgStore } from '../../../utils/src/msgStore';
import { ClaudeLogProcessor, HistoryStrategy, EntryIndexProvider } from '../logs';
import { normalizeStderrLogs } from '../logs/stderrProcessor';

/**
 * Claude Code executor - equivalent to Rust's ClaudeCode executor
 */
export class ClaudeCode {
  constructor(
    private command: CommandBuilder,
    private appendPrompt?: string,
    private plan: boolean = false
  ) {}

  /**
   * Spawn initial execution (matches Rust ClaudeCode::spawn)
   */
  async spawn(currentDir: string, prompt: string): Promise<ProcessManager> {
    const claudeCommand = this.plan 
      ? this.createWatchkillScript(this.command.buildInitial())
      : this.command.buildInitial();

    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 ClaudeCode.spawn called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Plan mode: ${this.plan}`);
    logger.info(`   - Command: ${claudeCommand}`);
    logger.info(`   - Combined prompt length: ${combinedPrompt.length} chars`);
    logger.debug(`   - Prompt preview: ${combinedPrompt.substring(0, 200)}...`);
    
    const processManager = new ProcessManager();
    
    logger.info(`🚀 About to spawn ProcessManager...`);
    await processManager.spawn(claudeCommand, currentDir, combinedPrompt);
    
    logger.info(`✅ ClaudeCode ProcessManager spawned successfully`);
    return processManager;
  }

  /**
   * Spawn follow-up execution (matches Rust ClaudeCode::spawn_follow_up)
   */
  async spawnFollowUp(currentDir: string, prompt: string, sessionId: string): Promise<ProcessManager> {
    // When using --print (-p) mode with --resume, the session ID must be provided with = sign
    // The command should be: claude -p --resume=<session_id>
    const resumeArgs = sessionId ? [`--resume=${sessionId}`] : [];
    
    const claudeCommand = this.plan
      ? this.createWatchkillScript(this.command.buildFollowUp(resumeArgs))
      : this.command.buildFollowUp(resumeArgs);

    const combinedPrompt = this.combinePrompt(prompt);
    
    logger.info(`🤖 ClaudeCode.spawnFollowUp called:`);
    logger.info(`   - Current dir: ${currentDir}`);
    logger.info(`   - Session ID: ${sessionId}`);
    logger.info(`   - Command: ${claudeCommand}`);
    logger.info(`   - Combined prompt length: ${combinedPrompt.length} chars`);
    
    if (!sessionId) {
      logger.warn(`⚠️ No session ID provided for follow-up execution`);
    }
    
    const processManager = new ProcessManager();
    await processManager.spawn(claudeCommand, currentDir, combinedPrompt);
    
    logger.info(`✅ ClaudeCode follow-up ProcessManager spawned successfully`);
    return processManager;
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
   * Create watchkill script for plan mode (matches Rust create_watchkill_script)
   */
  private createWatchkillScript(command: string): string {
    const claudePlanStopIndicator = 'Exit plan mode?';
    
    // Use a simple bash script approach (cross-platform considerations)
    if (process.platform === 'win32') {
      // Windows batch script
      return `@echo off\n${command}`;
    } else {
      // Unix shell script that watches for plan mode exit
      return `#!/usr/bin/env bash
set -euo pipefail

word="${claudePlanStopIndicator}"
command="${command}"

exit_code=0
while IFS= read -r line; do
    printf '%s\\n' "$line"
    if [[ $line == *"$word"* ]]; then
        exit 0
    fi
done < <($command <&0 2>&1)

exit_code=\${PIPESTATUS[0]}
exit "$exit_code"
`;
    }
  }

  /**
   * Create default Claude Code executor (matches Rust defaults)
   */
  static createDefault(): ClaudeCode {
    const command = CommandBuilder.new('npx -y @anthropic-ai/claude-code@latest')
      .params(['-p', '--dangerously-skip-permissions', '--verbose', '--output-format=stream-json']);
    return new ClaudeCode(command, undefined, false);
  }

  /**
   * Create Claude Code executor with plan mode
   */
  static createWithPlan(): ClaudeCode {
    const command = CommandBuilder.new('npx -y @anthropic-ai/claude-code@latest')
      .params(['-p', '--permission-mode=plan', '--verbose', '--output-format=stream-json']);
    return new ClaudeCode(command, undefined, true);
  }

  /**
   * Create Claude Code executor with custom parameters
   */
  static createWithParams(params: string[], appendPrompt?: string, plan = false): ClaudeCode {
    const command = CommandBuilder.new('npx -y @anthropic-ai/claude-code@latest').params(params);
    return new ClaudeCode(command, appendPrompt, plan);
  }

  /**
   * Normalize logs from Claude output (matches Rust ClaudeCode::normalize_logs)
   * Processes raw stdout/stderr logs and converts them to structured normalized entries
   */
  normalizeLogs(msgStore: MsgStore, currentDir: string): void {
    logger.info(`[ClaudeCode.normalizeLogs] Starting log normalization for dir: ${currentDir}`);
    
    const entryIndexProvider = EntryIndexProvider.startFrom(msgStore);
    // Start async log processing (non-blocking)
    logger.info(`[ClaudeCode.normalizeLogs] Starting ClaudeLogProcessor.processLogs`);
    ClaudeLogProcessor.processLogs(
      msgStore,
      currentDir,
      entryIndexProvider,
      HistoryStrategy.Default
    ).catch(error => {
      logger.error('[ClaudeCode.normalizeLogs] Failed to process Claude logs:', error);
    });

    // Process stderr logs using the standard stderr processor
    logger.info(`[ClaudeCode.normalizeLogs] Starting normalizeStderrLogs`);
    normalizeStderrLogs(msgStore, entryIndexProvider);
    
    logger.info(`[ClaudeCode.normalizeLogs] Log normalization setup complete`);
  }
}
