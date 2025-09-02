import { spawn } from 'child_process';
import { ExecutableAction, ScriptRequestLanguage, ScriptContext, AsyncGroupChild } from './base';

export class ScriptRequest implements ExecutableAction {
  public readonly type = 'ScriptRequest' as const;
  
  constructor(
    public readonly script: string,
    public readonly language: ScriptRequestLanguage,
    public readonly context: ScriptContext
  ) {}

  async spawn(currentDir: string): Promise<AsyncGroupChild> {
    // Get shell command based on platform and language
    const { shellCmd, shellArg } = this.getShellCommand();
    
    const process = spawn(shellCmd, [shellArg, this.script], {
      cwd: currentDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    return new AsyncGroupChild(process, process.stdout, process.stderr);
  }

  private getShellCommand(): { shellCmd: string; shellArg: string } {
    if (process.platform === 'win32') {
      return { shellCmd: 'cmd', shellArg: '/c' };
    } else {
      return { shellCmd: '/bin/bash', shellArg: '-c' };
    }
  }
}
