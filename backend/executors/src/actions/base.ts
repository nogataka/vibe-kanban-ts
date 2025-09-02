import { ChildProcess } from 'child_process';

export interface ExecutableAction {
  spawn(currentDir: string): Promise<AsyncGroupChild>;
}

export interface ProfileVariantLabel {
  profile: string;
  variant?: string;
}

export enum ScriptRequestLanguage {
  Bash = 'Bash'
}

export enum ScriptContext {
  SetupScript = 'SetupScript',
  CleanupScript = 'CleanupScript', 
  DevServer = 'DevServer'
}

export interface CodingAgentInitialRequest extends ExecutableAction {
  type: 'CodingAgentInitialRequest';
  prompt: string;
  profileVariantLabel: ProfileVariantLabel;
}

export interface CodingAgentFollowUpRequest extends ExecutableAction {
  type: 'CodingAgentFollowUpRequest';
  prompt: string;
  sessionId: string;
  profileVariantLabel: ProfileVariantLabel;
}

export interface ScriptRequest extends ExecutableAction {
  type: 'ScriptRequest';
  script: string;
  language: ScriptRequestLanguage;
  context: ScriptContext;
}

export type ExecutorActionType = 
  | CodingAgentInitialRequest
  | CodingAgentFollowUpRequest
  | ScriptRequest;

export interface ExecutorAction {
  type: ExecutorActionType;
  nextAction?: ExecutorAction;
}

// Base class similar to Rust's AsyncGroupChild
export class AsyncGroupChild {
  constructor(
    public readonly process: ChildProcess,
    public readonly stdout: NodeJS.ReadableStream | null = null,
    public readonly stderr: NodeJS.ReadableStream | null = null
  ) {}

  async kill(): Promise<void> {
    if (this.process.kill) {
      this.process.kill('SIGTERM');
    }
  }

  async wait(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.process.on('exit', (code: number | null) => resolve(code || 0));
      this.process.on('error', reject);
    });
  }
}
