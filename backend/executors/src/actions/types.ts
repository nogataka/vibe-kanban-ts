// Executor Action types based on Rust implementation

export enum ScriptRequestLanguage {
  BASH = 'bash',
  PYTHON = 'python',
  JAVASCRIPT = 'javascript',
  TYPESCRIPT = 'typescript'
}

export enum ScriptContext {
  SETUP = 'setup',
  CLEANUP = 'cleanup',
  DEV = 'dev',
  TEST = 'test'
}

// Base executor action interface
export interface ExecutorActionBase {
  type: string;
}

// Script execution action
export interface ScriptAction extends ExecutorActionBase {
  type: 'script';
  script_content: string;
  language: ScriptRequestLanguage;
  context: ScriptContext;
}

// Coding agent initial request
export interface CodingAgentInitialAction extends ExecutorActionBase {
  type: 'coding_agent_initial';
  prompt: string;
  profile: string;
  variant?: string;
}

// Coding agent follow-up request  
export interface CodingAgentFollowUpAction extends ExecutorActionBase {
  type: 'coding_agent_follow_up';
  prompt: string;
  session_id: string;
  profile: string;
  variant?: string;
}

// Union type for all executor actions
export type ExecutorAction = 
  | ScriptAction 
  | CodingAgentInitialAction 
  | CodingAgentFollowUpAction;

// Profile variant label
export interface ProfileVariantLabel {
  profile: string;
  variant?: string;
}

// Async group child (process result)
export interface AsyncGroupChild {
  pid: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}

// Command configuration
export interface CommandConfig {
  base: string;
  params: string[];
}

// Profile configuration structures
export interface ClaudeCodeProfile {
  command: CommandConfig;
  plan: boolean;
}

export interface AmpProfile {
  command: CommandConfig;
}

export interface GeminiProfile {
  command: CommandConfig;
}

export interface CodexProfile {
  command: CommandConfig;
}

export interface OpencodeProfile {
  command: CommandConfig;
}

export interface CursorProfile {
  command: CommandConfig;
}

// Profile variant
export interface ProfileVariant {
  label: string;
  mcp_config_path?: string;
  CLAUDE_CODE?: ClaudeCodeProfile;
  AMP?: AmpProfile;
  GEMINI?: GeminiProfile;
  CODEX?: CodexProfile;
  OPENCODE?: OpencodeProfile;
  CURSOR?: CursorProfile;
}

// Main profile
export interface Profile {
  label: string;
  mcp_config_path?: string;
  CLAUDE_CODE?: ClaudeCodeProfile;
  AMP?: AmpProfile;
  GEMINI?: GeminiProfile;
  CODEX?: CodexProfile;
  OPENCODE?: OpencodeProfile;
  CURSOR?: CursorProfile;
  variants: ProfileVariant[];
}

// Execution context for executors
export interface ExecutionContext {
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  projectPath: string;
  worktreePath: string;
  profile: Profile;
  environment?: Record<string, string>;
}

// Execution result
export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  sessionId?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}
