import { ProcessManager } from '../../services/src/services/process/processManager';
import { ClaudeCode } from './executors/claude';
import { Amp } from './executors/amp';
import { Codex } from './executors/codex';
import { Cursor } from './executors/cursor';
import { Gemini } from './executors/gemini';
import { Opencode } from './executors/opencode';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/src/logger';
import { MsgStore } from '../../utils/src/msgStore';
import { ProfileService } from '../../services/src/services/profileService';

const execAsync = promisify(spawn);

/**
 * Executor action types (matches Rust ExecutorActionType)
 */
export type ExecutorActionType = 
  | { type: 'CodingAgentInitialRequest'; prompt: string; profile_variant_label: { profile: string; variant: string | null } }
  | { type: 'CodingAgentFollowUpRequest'; prompt: string; profile_variant_label: { profile: string; variant: string | null }; session_id: string }
  | { type: 'ScriptRequest'; script: string; language: string; context: string };

/**
 * Executor action structure (matches Rust ExecutorAction)
 */
export interface ExecutorAction {
  typ: ExecutorActionType;
  next_action?: ExecutorAction;
}

/**
 * Executable interface (matches Rust Executable trait)
 */
export interface Executable {
  spawn(currentDir: string): Promise<ProcessManager>;
}

/**
 * Implementation of Executable for ExecutorAction
 */
export class ExecutorActionExecutor implements Executable {
  private executor?: ClaudeCode | Amp | Codex | Cursor | Gemini | Opencode;
  
  constructor(private action: ExecutorAction) {}

  /**
   * Spawn execution based on action type (matches Rust Executable::spawn)
   */
  async spawn(currentDir: string): Promise<ProcessManager> {
    const { typ } = this.action;

    switch (typ.type) {
      case 'CodingAgentInitialRequest':
        return await this.spawnCodingAgent(currentDir, typ.prompt, typ.profile_variant_label);
      
      case 'CodingAgentFollowUpRequest':
        return await this.spawnCodingAgentFollowUp(currentDir, typ.prompt, typ.session_id, typ.profile_variant_label);
      
      case 'ScriptRequest':
        return await this.spawnScript(currentDir, typ.script);
      
      default:
        throw new Error(`Unsupported executor action type: ${(typ as any).type}`);
    }
  }

  /**
   * Spawn coding agent execution
   */
  private async spawnCodingAgent(currentDir: string, prompt: string, profileLabel: { profile: string; variant: string | null }): Promise<ProcessManager> {
    // Get executor based on profile
    this.executor = await this.getExecutorForProfile(profileLabel.profile);
    
    if ('spawn' in this.executor) {
      return await this.executor.spawn(currentDir, prompt);
    }
    
    throw new Error(`Executor for profile ${profileLabel.profile} does not support spawn`);
  }

  /**
   * Spawn coding agent follow-up execution  
   */
  private async spawnCodingAgentFollowUp(
    currentDir: string, 
    prompt: string, 
    sessionId: string,
    profileLabel: { profile: string; variant: string | null }
  ): Promise<ProcessManager> {
    // Get executor based on profile
    this.executor = await this.getExecutorForProfile(profileLabel.profile);
    
    if ('spawnFollowUp' in this.executor) {
      return await this.executor.spawnFollowUp(currentDir, prompt, sessionId);
    }
    
    throw new Error(`Executor for profile ${profileLabel.profile} does not support follow-up`);
  }

  /**
   * Spawn script execution
   */
  private async spawnScript(currentDir: string, script: string): Promise<ProcessManager> {
    logger.info(`Executing script in ${currentDir}: ${script}`);
    
    const processManager = new ProcessManager();
    await processManager.spawn(script, currentDir, ''); // No prompt for scripts
    
    return processManager;
  }
  
  /**
   * Get executor based on profile label
   */
  private async getExecutorForProfile(profileLabel: string): Promise<any> {
    const profileService = ProfileService.getInstance();
    const profiles = await profileService.getProfiles();
    const profile = profiles.find(p => p.label === profileLabel);
    
    if (!profile) {
      logger.warn(`Profile ${profileLabel} not found, using default claude-code`);
      return ClaudeCode.createDefault();
    }
    
    // Determine executor type based on profile properties
    if (profile.CLAUDE_CODE) {
      return ClaudeCode.createDefault();
    } else if (profile.AMP) {
      return Amp.createDefault();
    } else if (profile.CODEX) {
      return Codex.createDefault();
    } else if (profile.CURSOR) {
      return Cursor.createDefault();
    } else if (profile.GEMINI) {
      return Gemini.createDefault();
    } else if (profile.OPENCODE) {
      return Opencode.createDefault();
    } else {
      logger.warn(`Unknown executor type for profile ${profileLabel}, using default claude-code`);
      return ClaudeCode.createDefault();
    }
  }
  
  /**
   * Normalize logs if executor supports it
   */
  normalizeLogs(msgStore: MsgStore, currentDir: string): void {
    if (this.executor && 'normalizeLogs' in this.executor) {
      logger.info(`[ExecutorActionExecutor] Calling ${this.executor.constructor.name}.normalizeLogs`);
      this.executor.normalizeLogs(msgStore, currentDir);
    }
  }
  
  /**
   * Normalize logs if executor supports it (for backward compatibility)
   */
  normalizeLogsIfClaude(msgStore: MsgStore, currentDir: string): void {
    this.normalizeLogs(msgStore, currentDir);
  }
}

/**
 * Utility functions for creating ExecutorActions
 */
export class ExecutorActionFactory {
  /**
   * Create coding agent initial request (matches Rust structure)
   */
  static createCodingAgentInitial(
    prompt: string, 
    profileLabel = 'claude-code',
    nextAction?: ExecutorAction
  ): ExecutorAction {
    return {
      typ: {
        type: 'CodingAgentInitialRequest',
        prompt,
        profile_variant_label: {
          profile: profileLabel,
          variant: null
        }
      },
      next_action: nextAction
    };
  }

  /**
   * Create script request (matches Rust structure)
   */
  static createScriptRequest(
    script: string,
    language = 'bash',
    context = 'script',
    nextAction?: ExecutorAction
  ): ExecutorAction {
    return {
      typ: {
        type: 'ScriptRequest',
        script,
        language,
        context
      },
      next_action: nextAction
    };
  }

  /**
   * Create follow-up request (matches Rust structure)
   */
  static createCodingAgentFollowUp(
    prompt: string,
    sessionId: string,
    profileLabel = 'claude-code',
    nextAction?: ExecutorAction
  ): ExecutorAction {
    return {
      typ: {
        type: 'CodingAgentFollowUpRequest',
        prompt,
        profile_variant_label: {
          profile: profileLabel,
          variant: null
        },
        session_id: sessionId
      },
      next_action: nextAction
    };
  }
}
