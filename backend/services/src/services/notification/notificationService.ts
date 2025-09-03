import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../../../utils/src/logger';
import { SoundFile, soundFileToPath, NotificationConfig as ConfigNotificationConfig } from '../config/configService';

const execAsync = promisify(exec);

export interface NotificationConfig extends ConfigNotificationConfig {
  // Inherits sound_enabled, push_enabled, sound_file from config
}

export class NotificationError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'NotificationError';
  }
}

export interface ExecutionContext {
  task: {
    id: string;
    title: string;
  };
  task_attempt: {
    id: string;
    branch?: string;
    profile: string;
  };
  execution_process: {
    status: 'completed' | 'failed' | 'killed' | 'running';
  };
}

export class NotificationService {
  private soundCacheDir: string;

  constructor() {
    this.soundCacheDir = path.join(process.cwd(), 'data', 'cache', 'sounds');
    this.initializeSoundCache();
  }

  /**
   * Initialize sound cache directory
   */
  private async initializeSoundCache(): Promise<void> {
    try {
      await fs.mkdir(this.soundCacheDir, { recursive: true });
      await this.createDefaultSounds();
    } catch (error) {
      logger.error('Failed to initialize sound cache:', error);
    }
  }

  /**
   * Create default sound files
   */
  private async createDefaultSounds(): Promise<void> {
    // Create simple beep sounds for different events
    // In a real implementation, you might want to include actual sound files
    const sounds = [
      { type: 'success', filename: 'success.wav' },
      { type: 'error', filename: 'error.wav' },
      { type: 'cancelled', filename: 'cancelled.wav' }
    ];

    for (const sound of sounds) {
      const soundPath = path.join(this.soundCacheDir, sound.filename);
      try {
        await fs.access(soundPath);
      } catch {
        // Sound file doesn't exist, create a placeholder
        // In production, you would copy actual audio files here
        await fs.writeFile(soundPath, '# Placeholder sound file\n');
      }
    }
  }

  /**
   * Notify when execution is halted
   */
  async notifyExecutionHalted(config: NotificationConfig, ctx: ExecutionContext): Promise<void> {
    // Suppress sound if the process was intentionally killed
    if (ctx.execution_process.status === 'killed') {
      config = { ...config, sound_enabled: false };
    }

    const title = `Task Complete: ${ctx.task.title}`;
    
    let message: string;

    switch (ctx.execution_process.status) {
      case 'completed':
        message = `✅ '${ctx.task.title}' completed successfully\nBranch: ${ctx.task_attempt.branch}\nExecutor: ${ctx.task_attempt.profile}`;
        break;
      
      case 'failed':
        message = `❌ '${ctx.task.title}' execution failed\nBranch: ${ctx.task_attempt.branch}\nExecutor: ${ctx.task_attempt.profile}`;
        break;
      
      case 'killed':
        message = `🛑 '${ctx.task.title}' execution cancelled by user\nBranch: ${ctx.task_attempt.branch}\nExecutor: ${ctx.task_attempt.profile}`;
        break;
      
      default:
        logger.warn(`Tried to notify attempt completion for ${ctx.task_attempt.id} but process is still running!`);
        return;
    }

    // Use the sound file from config (already has the correct SoundFile enum)
    await this.notify(config, title, message);
  }

  /**
   * Send both sound and push notifications if enabled
   */
  async notify(config: NotificationConfig, title: string, message: string): Promise<void> {
    const promises: Promise<void>[] = [];

    if (config.sound_enabled) {
      promises.push(this.playSoundNotification(config.sound_file));
    }

    if (config.push_enabled) {
      promises.push(this.sendPushNotification(title, message));
    }

    // Run notifications in parallel
    await Promise.allSettled(promises);
  }

  /**
   * Play a system sound notification across platforms
   */
  private async playSoundNotification(soundFile: SoundFile): Promise<void> {
    try {
      const soundPath = await this.getSoundFilePath(soundFile);
      
      if (!soundPath) {
        logger.warn('No sound file available for notification');
        return;
      }

      const platform = process.platform;
      
      switch (platform) {
        case 'darwin': // macOS
          await this.playMacSound(soundPath);
          break;
          
        case 'win32': // Windows
          await this.playWindowsSound(soundPath);
          break;
          
        case 'linux': // Linux
          await this.playLinuxSound(soundPath);
          break;
          
        default:
          logger.warn(`Sound notifications not supported on platform: ${platform}`);
      }
    } catch (error) {
      logger.error('Failed to play sound notification:', error);
    }
  }

  /**
   * Play sound on macOS
   */
  private async playMacSound(soundPath: string): Promise<void> {
    try {
      // Use afplay on macOS
      exec(`afplay "${soundPath}"`, (error) => {
        if (error) {
          logger.debug('afplay failed, trying system bell');
          // Fallback to system bell
          exec('echo -e "\\a"');
        }
      });
    } catch (error) {
      logger.debug('macOS sound failed:', error);
    }
  }

  /**
   * Play sound on Windows
   */
  private async playWindowsSound(soundPath: string): Promise<void> {
    try {
      // Use PowerShell to play sound on Windows
      const command = `powershell -c "(New-Object Media.SoundPlayer '${soundPath}').PlaySync()"`;
      exec(command, (error) => {
        if (error) {
          logger.debug('Windows sound failed, trying system beep');
          // Fallback to system beep
          exec('echo \\a');
        }
      });
    } catch (error) {
      logger.debug('Windows sound failed:', error);
    }
  }

  /**
   * Play sound on Linux
   */
  private async playLinuxSound(soundPath: string): Promise<void> {
    try {
      // Try different Linux audio players
      const players = [
        { cmd: 'paplay', args: [soundPath] },
        { cmd: 'aplay', args: [soundPath] },
        { cmd: 'sox', args: [soundPath, '-d'] },
        { cmd: 'mpv', args: ['--no-video', soundPath] }
      ];

      let played = false;
      
      for (const player of players) {
        try {
          await execAsync(`which ${player.cmd}`);
          exec(`${player.cmd} ${player.args.map(arg => `"${arg}"`).join(' ')}`);
          played = true;
          break;
        } catch {
          // Player not available, try next
          continue;
        }
      }

      if (!played) {
        // Fallback to system bell
        exec('echo -e "\\a"');
      }
    } catch (error) {
      logger.debug('Linux sound failed:', error);
    }
  }

  /**
   * Send push notification (using native system notifications)
   */
  private async sendPushNotification(title: string, message: string): Promise<void> {
    try {
      const platform = process.platform;
      
      switch (platform) {
        case 'darwin': // macOS
          await this.sendMacNotification(title, message);
          break;
          
        case 'win32': // Windows
          await this.sendWindowsNotification(title, message);
          break;
          
        case 'linux': // Linux
          await this.sendLinuxNotification(title, message);
          break;
          
        default:
          logger.warn(`Push notifications not supported on platform: ${platform}`);
      }
    } catch (error) {
      logger.error('Failed to send push notification:', error);
    }
  }

  /**
   * Send notification on macOS
   */
  private async sendMacNotification(title: string, message: string): Promise<void> {
    try {
      const escapedTitle = title.replace(/"/g, '\\"');
      const escapedMessage = message.replace(/"/g, '\\"');
      
      exec(`osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`);
    } catch (error) {
      logger.debug('macOS notification failed:', error);
    }
  }

  /**
   * Send notification on Windows
   */
  private async sendWindowsNotification(title: string, message: string): Promise<void> {
    try {
      const powershellScript = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $template.SelectSingleNode('//text[@id="1"]').InnerText = "${title.replace(/"/g, '""')}"
        $template.SelectSingleNode('//text[@id="2"]').InnerText = "${message.replace(/"/g, '""')}"
        $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("vibe-kanban").Show($toast)
      `;
      
      exec(`powershell -c "${powershellScript}"`);
    } catch (error) {
      logger.debug('Windows notification failed:', error);
    }
  }

  /**
   * Send notification on Linux
   */
  private async sendLinuxNotification(title: string, message: string): Promise<void> {
    try {
      // Try notify-send first
      try {
        await execAsync('which notify-send');
        exec(`notify-send "${title}" "${message}"`);
        return;
      } catch {
        // notify-send not available
      }

      // Try zenity
      try {
        await execAsync('which zenity');
        exec(`zenity --info --title="${title}" --text="${message}"`);
        return;
      } catch {
        // zenity not available
      }

      logger.debug('No notification system found on Linux');
    } catch (error) {
      logger.debug('Linux notification failed:', error);
    }
  }

  /**
   * Get sound file path for the given sound type
   */
  private async getSoundFilePath(soundFile: SoundFile): Promise<string | null> {
    // Use the soundFileToPath helper from configService
    const filename = soundFileToPath(soundFile);
    
    // Try to find the sound file in assets directory first
    const assetsPath = path.join(process.cwd(), '..', 'assets', 'sounds', filename);
    try {
      await fs.access(assetsPath);
      return assetsPath;
    } catch {
      // Fall back to cache directory
      const soundPath = path.join(this.soundCacheDir, filename);
      try {
        await fs.access(soundPath);
        return soundPath;
      } catch {
        logger.warn(`Sound file not found: ${filename}`);
        return null;
      }
    }
  }

  /**
   * Check if sound notifications are supported
   */
  isSoundSupported(): boolean {
    const platform = process.platform;
    return ['darwin', 'win32', 'linux'].includes(platform);
  }

  /**
   * Check if push notifications are supported
   */
  isPushSupported(): boolean {
    const platform = process.platform;
    return ['darwin', 'win32', 'linux'].includes(platform);
  }

  /**
   * Get notification capabilities
   */
  getCapabilities(): {
    soundSupported: boolean;
    pushSupported: boolean;
    platform: string;
  } {
    return {
      soundSupported: this.isSoundSupported(),
      pushSupported: this.isPushSupported(),
      platform: process.platform
    };
  }

  /**
   * Test notifications
   */
  async testNotifications(config: NotificationConfig): Promise<void> {
    const title = 'Vibe Kanban Test';
    const message = 'This is a test notification to verify your notification settings.';
    
    await this.notify(config, title, message);
  }

  /**
   * Cleanup service resources
   */
  cleanup(): void {
    // No persistent resources to cleanup
  }
}
