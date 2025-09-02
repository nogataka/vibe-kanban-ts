import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../../../../utils/src/logger';

/**
 * Process manager for handling child processes
 * Equivalent to Rust's AsyncGroupChild functionality
 */
export class ProcessManager extends EventEmitter {
  private child?: ChildProcess;
  private exitCode?: number;
  private isFinished = false;

  /**
   * Spawn a new process (matches Rust executor.spawn)
   */
  async spawn(command: string, workingDir: string, prompt: string): Promise<void> {
    const [shell, shellArg] = this.getShellCommand();
    
    logger.info(`🔧 ProcessManager.spawn called:`);
    logger.info(`   - Command: ${command}`);
    logger.info(`   - Working directory: ${workingDir}`);
    logger.info(`   - Prompt length: ${prompt.length} chars`);
    logger.info(`   - Shell: ${shell} ${shellArg}`);
    
    this.child = spawn(shell, [shellArg, command], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false // Enable process group for better cleanup
    });

    if (!this.child) {
      logger.error(`❌ Failed to spawn child process`);
      throw new Error('Failed to spawn child process');
    }

    logger.info(`✅ Child process spawned successfully, PID: ${this.child.pid}`);

    // Set up event handlers BEFORE sending input
    // Handle stdout
    this.child.stdout?.on('data', (data: Buffer) => {
      const content = data.toString();
      logger.info(`📺 STDOUT (${content.length} chars): ${content.substring(0, 100)}...`);
      this.emit('stdout', content);
    });
    
    // Handle stderr
    this.child.stderr?.on('data', (data: Buffer) => {
      const content = data.toString();
      logger.info(`📺 STDERR (${content.length} chars): ${content.substring(0, 100)}...`);
      this.emit('stderr', content);
    });

    // Handle process exit
    this.child.on('exit', (code, signal) => {
      this.exitCode = code !== null ? code : -1;
      this.isFinished = true;
      this.emit('exit', { code, signal });
      logger.info(`🏁 Process ${this.child?.pid} exited with code ${code}, signal ${signal}`);
    });

    // Handle process errors
    this.child.on('error', (error) => {
      this.emit('error', error);
      logger.error(`💥 Process ${this.child?.pid} error:`, error);
    });

    // NOW send prompt to stdin and close
    if (this.child.stdin) {
      logger.info(`📝 Sending prompt to stdin (${prompt.length} chars)`);
      this.child.stdin.write(prompt);
      this.child.stdin.end();
      logger.info(`🔒 Stdin closed`);
    } else {
      logger.warn(`⚠️ No stdin available for process ${this.child.pid}`);
    }
  }

  /**
   * Check if process is still running (matches Rust try_wait)
   */
  tryWait(): { finished: boolean; exitCode?: number; error?: Error } {
    if (this.isFinished) {
      return { finished: true, exitCode: this.exitCode };
    }
    
    if (!this.child) {
      return { finished: true, error: new Error('Process not started') };
    }

    // In Node.js, we can't non-blockingly check exit status like Rust's try_wait
    // We rely on the 'exit' event setting isFinished
    return { finished: false };
  }

  /**
   * Kill the process (matches Rust kill functionality)
   */
  kill(): void {
    if (this.child && !this.isFinished) {
      logger.info(`Killing process ${this.child.pid}`);
      
      // Try graceful termination first
      this.child.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (!this.isFinished && this.child) {
          logger.warn(`Force killing process ${this.child.pid}`);
          this.child.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  /**
   * Get shell command for current platform
   */
  private getShellCommand(): [string, string] {
    if (process.platform === 'win32') {
      return ['cmd', '/c'];
    } else {
      return ['sh', '-c'];
    }
  }

  /**
   * Get process ID
   */
  getPid(): number | undefined {
    return this.child?.pid;
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return !this.isFinished && !!this.child;
  }
}
