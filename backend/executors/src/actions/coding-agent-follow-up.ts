import { spawn } from 'child_process';
import { ExecutableAction, ProfileVariantLabel, AsyncGroupChild } from './base';

export class CodingAgentFollowUpRequest implements ExecutableAction {
  public readonly type = 'CodingAgentFollowUpRequest' as const;
  
  constructor(
    public readonly prompt: string,
    public readonly sessionId: string,
    public readonly profileVariantLabel: ProfileVariantLabel
  ) {}

  async spawn(currentDir: string): Promise<AsyncGroupChild> {
    // Follow-up execution with session context
    const process = spawn('echo', [
      `Executing follow-up coding request: ${this.prompt} (Session: ${this.sessionId})`
    ], {
      cwd: currentDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    return new AsyncGroupChild(process, process.stdout, process.stderr);
  }
}
