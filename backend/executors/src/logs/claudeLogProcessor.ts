import { MsgStore, LogMsg } from '../../../utils/src/msgStore';
import { 
  NormalizedEntry, 
  NormalizedEntryType, 
  ActionType, 
  FileChange,
  TodoItem,
  CommandRunResult,
  ToolResult,
  ToolResultValueType 
} from './types';
import { ConversationPatch } from './conversationPatch';
import { EntryIndexProvider } from './entryIndexProvider';
import { logger } from '../../../utils/src/logger';
import { makePathRelative } from '../../../utils/src/path';
import { createUnifiedDiff, createUnifiedDiffHunk, concatenateDiffHunks } from '../../../utils/src/diff';

// Claude JSON message types
export interface ClaudeSystem {
  subtype?: string;
  session_id?: string;
  cwd?: string;
  tools?: any[];
  model?: string;
}

export interface ClaudeAssistant {
  message: ClaudeMessage;
  session_id?: string;
}

export interface ClaudeUser {
  message: ClaudeMessage;
  session_id?: string;
}

export interface ClaudeToolUse {
  tool_name: string;
  tool_data?: ClaudeToolData;
  session_id?: string;
}

export interface ClaudeToolResult {
  result: any;
  is_error?: boolean;
  session_id?: string;
}

export interface ClaudeResult {
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  result?: any;
}

export type ClaudeJson = 
  | { type: 'system' } & ClaudeSystem
  | { type: 'assistant' } & ClaudeAssistant
  | { type: 'user' } & ClaudeUser
  | { type: 'tool_use' } & ClaudeToolUse
  | { type: 'tool_result' } & ClaudeToolResult
  | { type: 'result' } & ClaudeResult
  | { type: 'unknown'; data: Record<string, any> };

export interface ClaudeMessage {
  id?: string;
  type?: string;
  model?: string;
  content: ClaudeContentItem[];
}

export type ClaudeContentItem = 
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name?: string; input?: any; tool_data?: ClaudeToolData }
  | { type: 'tool_result'; tool_use_id: string; content: any; is_error?: boolean };

// Claude Tool Data types
export interface ClaudeTodoItem {
  id?: string;
  content: string;
  status: string;
  priority?: string;
  activeForm?: string;
}

export interface ClaudeEditItem {
  old_string?: string;
  new_string?: string;
}

export type ClaudeToolData = 
  | { name: 'TodoWrite'; todos: ClaudeTodoItem[] }
  | { name: 'Task'; subagent_type?: string; description?: string; prompt?: string }
  | { name: 'Glob'; pattern: string; path?: string; limit?: number }
  | { name: 'LS'; path: string }
  | { name: 'Read'; file_path: string }
  | { name: 'Bash'; command: string; description?: string }
  | { name: 'Grep'; pattern: string; output_mode?: string; path?: string }
  | { name: 'ExitPlanMode'; plan: string }
  | { name: 'Edit'; file_path: string; old_string?: string; new_string?: string }
  | { name: 'MultiEdit'; file_path: string; edits: ClaudeEditItem[] }
  | { name: 'Write'; file_path: string; content: string }
  | { name: 'NotebookEdit'; notebook_path: string; new_source: string; edit_mode: string; cell_id?: string }
  | { name: 'WebFetch'; url: string; prompt?: string }
  | { name: 'WebSearch'; query: string; num_results?: number }
  | { name: 'Oracle'; task?: string; files?: string[]; context?: string }
  | { name: 'Mermaid'; code: string }
  | { name: 'CodebaseSearchAgent'; query?: string; path?: string; include?: string[]; exclude?: string[]; limit?: number }
  | { name: 'UndoEdit'; path?: string; steps?: number }
  | { name: 'TodoRead' }
  | { name: 'Unknown'; data: Record<string, any> };

interface ClaudeToolCallInfo {
  entry_index: number;
  tool_name: string;
  tool_data?: ClaudeToolData;
  content: string;
  action_type: ActionType;
}

export enum HistoryStrategy {
  Default = 'Default',
  AmpResume = 'AmpResume'
}

/**
 * Process Claude Code logs and convert them to normalized entries
 */
export class ClaudeLogProcessor {
  private modelName?: string;
  private toolMap: Map<string, ClaudeToolCallInfo> = new Map();
  private strategy: HistoryStrategy;

  constructor(strategy: HistoryStrategy = HistoryStrategy.Default) {
    this.strategy = strategy;
  }

  /**
   * Process raw logs and convert them to normalized entries with patches
   */
  public static async processLogs(
    msgStore: MsgStore,
    currentDir: string,
    entryIndexProvider: EntryIndexProvider,
    strategy: HistoryStrategy = HistoryStrategy.Default
  ): Promise<void> {
    logger.info(`[ClaudeLogProcessor.processLogs] Starting with strategy: ${strategy}`);
    
    const processor = new ClaudeLogProcessor(strategy);
    const worktreePath = currentDir;
    let sessionIdExtracted = false;
    let buffer = '';

    // Process existing history first
    const history = msgStore.getHistory();
    logger.info(`[ClaudeLogProcessor.processLogs] Processing ${history.length} history messages`);
    
    // Log first few messages for debugging
    if (history.length > 0) {
      logger.debug(`[ClaudeLogProcessor.processLogs] First message type: ${history[0].type}`);
      if (history[0].type === 'stdout') {
        logger.debug(`[ClaudeLogProcessor.processLogs] First stdout content preview: ${history[0].content?.substring(0, 200)}`);
      }
    }
    
    for (const msg of history) {
      if (msg.type === 'stdout' && msg.content) {
        buffer += msg.content;
        
        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines[lines.length - 1]; // Keep incomplete line in buffer

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Filter out claude-code-router service messages
          if (line.startsWith('Service not running, starting service') ||
              line.includes('claude code router service has been successfully stopped')) {
            continue;
          }

          try {
            const claudeJson = JSON.parse(line) as ClaudeJson;
            
            // Extract session ID if present
            if (!sessionIdExtracted) {
              const sessionId = processor.extractSessionId(claudeJson);
              if (sessionId) {
                msgStore.pushSessionId(sessionId);
                sessionIdExtracted = true;
              }
            }

            // Process based on message type
            logger.debug(`[ClaudeLogProcessor] Processing message type: ${claudeJson.type}`);
            if (claudeJson.type === 'assistant') {
              processor.processAssistantMessage(claudeJson, msgStore, entryIndexProvider, worktreePath);
            } else if (claudeJson.type === 'user') {
              processor.processUserMessage(claudeJson, msgStore, entryIndexProvider, worktreePath);
            } else {
              // Convert to normalized entries for other message types
              const entries = processor.toNormalizedEntries(claudeJson, worktreePath);
              for (const entry of entries) {
                const id = entryIndexProvider.next();
                const patch = ConversationPatch.addNormalizedEntry(id, entry);
                logger.debug(`[ClaudeLogProcessor] Pushing patch for entry ${id}:`, JSON.stringify(patch).substring(0, 200));
                msgStore.pushPatch(patch);
              }
            }
          } catch (e) {
            // Handle non-JSON output as raw system message
            if (line) {
              const entry: NormalizedEntry = {
                timestamp: null,
                entry_type: { type: 'system_message' },
                content: `Raw output: ${line}`,
                metadata: null
              };
              const id = entryIndexProvider.next();
              const patch = ConversationPatch.addNormalizedEntry(id, entry);
              logger.debug(`[ClaudeLogProcessor] Pushing system message patch for entry ${id}`);
              msgStore.pushPatch(patch);
            }
          }
        }
      }
    }

    // Subscribe to live message stream
    logger.info(`[ClaudeLogProcessor.processLogs] Setting up live message subscription`);
    const unsubscribe = msgStore.subscribe((msg: LogMsg) => {
      if (msg.type !== 'stdout') {
        logger.debug(`[ClaudeLogProcessor] Received non-stdout message: ${msg.type}`);
        return;
      }
      
      logger.debug(`[ClaudeLogProcessor] Received stdout message: ${msg.content?.substring(0, 100)}`);
      buffer += msg.content;

      // Process complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines[lines.length - 1]; // Keep incomplete line in buffer

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Filter out claude-code-router service messages
        if (line.startsWith('Service not running, starting service') ||
            line.includes('claude code router service has been successfully stopped')) {
          continue;
        }

        try {
          const claudeJson = JSON.parse(line) as ClaudeJson;
          
          // Extract session ID if present
          if (!sessionIdExtracted) {
            const sessionId = processor.extractSessionId(claudeJson);
            if (sessionId) {
              msgStore.pushSessionId(sessionId);
              sessionIdExtracted = true;
            }
          }

          // Process based on message type
          logger.info(`[ClaudeLogProcessor] Processing message type: ${claudeJson.type}`);
          if (claudeJson.type === 'assistant') {
            processor.processAssistantMessage(claudeJson, msgStore, entryIndexProvider, worktreePath);
          } else if (claudeJson.type === 'user') {
            processor.processUserMessage(claudeJson, msgStore, entryIndexProvider, worktreePath);
          } else {
            // Convert to normalized entries for other message types
            const entries = processor.toNormalizedEntries(claudeJson, worktreePath);
            for (const entry of entries) {
              const id = entryIndexProvider.next();
              const patch = ConversationPatch.addNormalizedEntry(id, entry);
              msgStore.pushPatch(patch);
            }
          }
        } catch (e) {
          // Handle non-JSON output as raw system message
          if (line) {
            const entry: NormalizedEntry = {
              timestamp: null,
              entry_type: { type: 'system_message' },
              content: `Raw output: ${line}`,
              metadata: null
            };
            const id = entryIndexProvider.next();
            const patch = ConversationPatch.addNormalizedEntry(id, entry);
            msgStore.pushPatch(patch);
          }
        }
      }
    });

    // Setup cleanup on finish event
    msgStore.once('finished', () => {
      unsubscribe();
      
      // Handle any remaining content in buffer
      if (buffer.trim()) {
        const entry: NormalizedEntry = {
          timestamp: null,
          entry_type: { type: 'system_message' },
          content: `Raw output: ${buffer.trim()}`,
          metadata: null
        };
        const id = entryIndexProvider.next();
        const patch = ConversationPatch.addNormalizedEntry(id, entry);
        msgStore.pushPatch(patch);
      }
    });
  }

  private processAssistantMessage(
    claudeJson: ClaudeAssistant,
    msgStore: MsgStore,
    entryIndexProvider: EntryIndexProvider,
    worktreePath: string
  ): void {
    const message = claudeJson.message;
    logger.info(`[ClaudeLogProcessor.processAssistantMessage] Processing assistant message with ${message.content.length} content items`);
    
    // Log first content item for debugging
    if (message.content.length > 0) {
      logger.info(`[ClaudeLogProcessor] First content item type: ${message.content[0].type}`);
      if (message.content[0].type === 'tool_use') {
        logger.info(`[ClaudeLogProcessor] Tool use detected:`, JSON.stringify(message.content[0]).substring(0, 500));
      }
    }

    // Inject system init with model if first time
    if (!this.modelName && message.model) {
      this.modelName = message.model;
      const entry: NormalizedEntry = {
        timestamp: null,
        entry_type: { type: 'system_message' },
        content: `System initialized with model: ${message.model}`,
        metadata: null
      };
      const id = entryIndexProvider.next();
      msgStore.pushPatch(ConversationPatch.addNormalizedEntry(id, entry));
    }

    // Process content items
    for (const item of message.content) {
      logger.info(`[ClaudeLogProcessor] Processing content item type: ${item.type}`);
      
      if (item.type === 'tool_use') {
        logger.info(`[ClaudeLogProcessor] Tool use item:`, JSON.stringify(item).substring(0, 500));
        
        // Claude's format has name and input as direct properties
        const toolName = item.name || (item.tool_data && item.tool_data.name);
        const toolInput = item.input || item.tool_data;
        
        if (!toolName) {
          logger.warn(`[ClaudeLogProcessor] Tool use item missing name field:`, JSON.stringify(item).substring(0, 200));
          continue;
        }
        
        // Create a normalized tool data object
        const toolData = {
          name: toolName,
          ...toolInput
        };
        
        const actionType = this.extractActionType(toolData, worktreePath);
        const contentText = this.generateConciseContent(toolData, actionType, worktreePath);
        
        logger.info(`[ClaudeLogProcessor] Extracted tool: ${toolName}, action: ${JSON.stringify(actionType).substring(0, 200)}`);
        
        const entry: NormalizedEntry = {
          timestamp: null,
          entry_type: { 
            type: 'tool_use',
            tool_name: toolName,
            action_type: actionType
          },
          content: contentText,
          metadata: item
        };
        
        const idNum = entryIndexProvider.next();
        this.toolMap.set(item.id, {
          entry_index: idNum,
          tool_name: toolName,
          tool_data: toolData,
          content: contentText,
          action_type: actionType
        });
        
        logger.info(`[ClaudeLogProcessor] Pushing tool_use patch for entry ${idNum}: ${toolName}`);
        
        msgStore.pushPatch(ConversationPatch.addNormalizedEntry(idNum, entry));
      } else if (item.type === 'text' || item.type === 'thinking') {
        const entry = this.contentItemToNormalizedEntry(item, 'assistant', worktreePath);
        if (entry) {
          const id = entryIndexProvider.next();
          msgStore.pushPatch(ConversationPatch.addNormalizedEntry(id, entry));
        }
      }
    }
  }

  private processUserMessage(
    claudeJson: ClaudeUser,
    msgStore: MsgStore,
    entryIndexProvider: EntryIndexProvider,
    worktreePath: string
  ): void {
    const message = claudeJson.message;

    // Handle AmpResume strategy
    if (this.strategy === HistoryStrategy.AmpResume) {
      const hasText = message.content.some(item => item.type === 'text');
      if (hasText) {
        const current = entryIndexProvider.current();
        if (current > 0) {
          // Clear all previous entries
          for (let i = 0; i < current; i++) {
            msgStore.pushPatch(ConversationPatch.removeDiff('0'));
          }
          entryIndexProvider.reset();
          this.toolMap.clear();
        }

        // Emit user text messages
        for (const item of message.content) {
          if (item.type === 'text') {
            const entry: NormalizedEntry = {
              timestamp: null,
              entry_type: { type: 'user_message' },
              content: item.text,
              metadata: item
            };
            const id = entryIndexProvider.next();
            msgStore.pushPatch(ConversationPatch.addNormalizedEntry(id, entry));
          }
        }
        return;
      }
    }

    // Process tool results
    for (const item of message.content) {
      if (item.type === 'tool_result' && item.tool_use_id) {
        const info = this.toolMap.get(item.tool_use_id);
        if (info && info.tool_data) {
          const isBashCommand = info.tool_data.name === 'Bash';
          const isReadCommand = info.tool_data.name === 'Read';
          
          if (isBashCommand) {
            // Update action type with command result
            const updatedActionType = this.updateBashActionWithResult(
              info.tool_data,
              item.content,
              item.is_error
            );
            
            const updatedEntry: NormalizedEntry = {
              timestamp: null,
              entry_type: {
                type: 'tool_use',
                tool_name: info.tool_name,
                action_type: updatedActionType
              },
              content: info.content,
              metadata: null
            };
            
            msgStore.pushPatch(ConversationPatch.replace(info.entry_index, updatedEntry));
          } else if (isReadCommand) {
            // For Read tool, we already have the complete entry from the initial tool_use
            // The action_type already contains file_read with the path
            // So we don't need to replace the entry
            logger.info(`[ClaudeLogProcessor] Skipping replace for Read tool (entry ${info.entry_index})`);
          } else {
            // Handle other tool results
            const [valueType, value] = this.normalizeClaudeToolResultValue(item.content);
            const toolResult: ToolResult = { type: valueType, value };
            
            const updatedActionType: ActionType = {
              action: 'tool',
              tool_name: info.tool_name,
              arguments: info.tool_data,
              result: toolResult
            };
            
            const updatedEntry: NormalizedEntry = {
              timestamp: null,
              entry_type: {
                type: 'tool_use',
                tool_name: info.tool_name,
                action_type: updatedActionType
              },
              content: info.content,
              metadata: null
            };
            
            msgStore.pushPatch(ConversationPatch.replace(info.entry_index, updatedEntry));
          }
        }
      }
    }
  }

  private extractSessionId(claudeJson: ClaudeJson): string | null {
    if ('session_id' in claudeJson && claudeJson.session_id) {
      return claudeJson.session_id;
    }
    return null;
  }

  private toNormalizedEntries(claudeJson: ClaudeJson, worktreePath: string): NormalizedEntry[] {
    switch (claudeJson.type) {
      case 'system':
        if (claudeJson.subtype === 'init') {
          // Skip system init messages
          return [];
        }
        return [{
          timestamp: null,
          entry_type: { type: 'system_message' },
          content: claudeJson.subtype ? `System: ${claudeJson.subtype}` : 'System message',
          metadata: claudeJson
        }];

      case 'tool_use':
        if (claudeJson.tool_data) {
          const toolName = this.getToolName(claudeJson.tool_data);
          const actionType = this.extractActionType(claudeJson.tool_data, worktreePath);
          const content = this.generateConciseContent(claudeJson.tool_data, actionType, worktreePath);
          
          return [{
            timestamp: null,
            entry_type: {
              type: 'tool_use',
              tool_name: toolName,
              action_type: actionType
            },
            content,
            metadata: claudeJson
          }];
        }
        return [];

      case 'result':
      case 'tool_result':
        // Skip these for now
        return [];

      case 'unknown':
        return [{
          timestamp: null,
          entry_type: { type: 'system_message' },
          content: `Unrecognized JSON message: ${JSON.stringify(claudeJson.data)}`,
          metadata: null
        }];

      default:
        return [];
    }
  }

  private contentItemToNormalizedEntry(
    item: ClaudeContentItem,
    role: string,
    worktreePath: string
  ): NormalizedEntry | null {
    switch (item.type) {
      case 'text':
        return {
          timestamp: null,
          entry_type: role === 'assistant' ? { type: 'assistant_message' } : { type: 'user_message' },
          content: item.text,
          metadata: item
        };

      case 'thinking':
        return {
          timestamp: null,
          entry_type: { type: 'thinking' },
          content: item.thinking,
          metadata: item
        };

      case 'tool_use':
        if (item.tool_data) {
          const toolName = this.getToolName(item.tool_data);
          const actionType = this.extractActionType(item.tool_data, worktreePath);
          const content = this.generateConciseContent(item.tool_data, actionType, worktreePath);
          
          return {
            timestamp: null,
            entry_type: {
              type: 'tool_use',
              tool_name: toolName,
              action_type: actionType
            },
            content,
            metadata: item
          };
        }
        return null;

      default:
        return null;
    }
  }

  private getToolName(toolData: any): string {
    // Handle both formats: toolData.name or direct name property
    return toolData.name || toolData;
  }

  private extractActionType(toolData: ClaudeToolData, worktreePath: string): ActionType {
    switch (toolData.name) {
      case 'Read':
        return {
          action: 'file_read',
          path: makePathRelative(toolData.file_path, worktreePath)
        };

      case 'Edit':
        const editChanges: FileChange[] = (toolData.old_string || toolData.new_string) ? [{
          action: 'edit',
          unified_diff: createUnifiedDiff(
            toolData.file_path,
            toolData.old_string || '',
            toolData.new_string || ''
          ),
          has_line_numbers: false
        }] : [];
        
        return {
          action: 'file_edit',
          path: makePathRelative(toolData.file_path, worktreePath),
          changes: editChanges
        };

      case 'MultiEdit':
        const hunks = toolData.edits
          .filter(edit => edit.old_string || edit.new_string)
          .map(edit => createUnifiedDiffHunk(
            edit.old_string || '',
            edit.new_string || ''
          ));
        
        const multiEditChanges: FileChange[] = hunks.length > 0 ? [{
          action: 'edit',
          unified_diff: concatenateDiffHunks(toolData.file_path, hunks),
          has_line_numbers: false
        }] : [];
        
        return {
          action: 'file_edit',
          path: makePathRelative(toolData.file_path, worktreePath),
          changes: multiEditChanges
        };

      case 'Write':
        return {
          action: 'file_edit',
          path: makePathRelative(toolData.file_path, worktreePath),
          changes: [{
            action: 'write',
            content: toolData.content
          }]
        };

      case 'Bash':
        return {
          action: 'command_run',
          command: toolData.command,
          result: undefined
        };

      case 'Grep':
      case 'Glob':
        return {
          action: 'search',
          query: toolData.name === 'Grep' ? toolData.pattern : toolData.pattern
        };

      case 'WebFetch':
        return {
          action: 'web_fetch',
          url: toolData.url
        };

      case 'WebSearch':
        return {
          action: 'search',
          query: toolData.query
        };

      case 'TodoWrite':
        return {
          action: 'todo_management',
          todos: toolData.todos.map(todo => ({
            content: todo.content,
            status: todo.status,
            priority: todo.priority || null
          })),
          operation: 'write'
        };

      case 'Task':
        return {
          action: 'task_create',
          description: toolData.description || toolData.prompt || 'Task created'
        };

      case 'ExitPlanMode':
        return {
          action: 'plan_presentation',
          plan: toolData.plan
        };

      default:
        return {
          action: 'other',
          description: `Tool: ${toolData.name}`
        };
    }
  }

  private generateConciseContent(
    toolData: ClaudeToolData,
    actionType: ActionType,
    worktreePath: string
  ): string {
    // For tools with specific formatting in Rust
    if (toolData.name === 'TodoWrite') {
      return 'TODO list updated';
    }

    // Format tool commands similar to Rust implementation
    switch (toolData.name) {
      case 'Read':
        return `\`${makePathRelative(toolData.file_path, worktreePath)}\``;

      case 'Edit':
        return `Editing ${makePathRelative(toolData.file_path, worktreePath)}`;

      case 'MultiEdit':
        return `Making ${toolData.edits.length} edits to ${makePathRelative(toolData.file_path, worktreePath)}`;

      case 'Write':
        return `Writing to ${makePathRelative(toolData.file_path, worktreePath)}`;

      case 'Bash':
        // Match Rust's format with backticks
        return `\`${toolData.command}\``;

      case 'Grep':
        return `Searching for "${toolData.pattern}"${toolData.path ? ` in ${toolData.path}` : ''}`;

      case 'Glob':
        return `Finding files matching "${toolData.pattern}"${toolData.path ? ` in ${toolData.path}` : ''}`;

      case 'WebFetch':
        return `Fetching ${toolData.url}`;

      case 'WebSearch':
        return `Searching web for "${toolData.query}"`;

      case 'Task':
        return toolData.description || 'Creating task';

      case 'ExitPlanMode':
        return 'Exiting plan mode';

      default:
        return `${toolData.name} tool`;
    }
  }

  private updateBashActionWithResult(
    toolData: ClaudeToolData,
    content: any,
    isError?: boolean
  ): ActionType {
    if (toolData.name !== 'Bash') {
      return { action: 'other', description: 'Not a bash command' };
    }

    let result: CommandRunResult | undefined;

    // Try to parse Amp-style bash result
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        if ('output' in parsed && 'exitCode' in parsed) {
          result = {
            exit_status: { type: 'exit_code', code: parsed.exitCode },
            output: parsed.output
          };
        }
      } catch {
        // Not JSON, treat as plain output
        result = {
          exit_status: isError 
            ? { type: 'exit_code', code: 1 } 
            : { type: 'success', success: true },
          output: content
        };
      }
    } else if (typeof content === 'object' && content) {
      // Handle structured result
      if ('output' in content && 'exitCode' in content) {
        result = {
          exit_status: { type: 'exit_code', code: content.exitCode },
          output: content.output
        };
      }
    }

    // Use backticks for command to match Rust formatting
    return {
      action: 'command_run',
      command: `\`${toolData.command}\``,
      result
    };
  }

  private normalizeClaudeToolResultValue(content: any): [ToolResultValueType, any] {
    // If content is a string, try to parse as JSON
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        return [ToolResultValueType.JSON, parsed];
      } catch {
        return [ToolResultValueType.MARKDOWN, content];
      }
    }

    // If content is an array of text items
    if (Array.isArray(content)) {
      const texts = content
        .filter(item => item && typeof item === 'object' && 'text' in item)
        .map(item => item.text);
      
      if (texts.length > 0) {
        const joined = texts.join('\n\n');
        try {
          const parsed = JSON.parse(joined);
          return [ToolResultValueType.JSON, parsed];
        } catch {
          return [ToolResultValueType.MARKDOWN, joined];
        }
      }
    }

    // Return as JSON for any other type
    return [ToolResultValueType.JSON, content];
  }
}