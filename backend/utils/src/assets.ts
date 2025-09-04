// Asset directory management - equivalent to Rust's utils/src/assets.rs
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { logger } from './logger';

/**
 * Get the appropriate asset directory path based on environment
 * 
 * Development: PROJECT_ROOT/dev_assets
 * Production: OS-appropriate app data directory
 * - macOS: ~/Library/Application Support/vibe-kanban
 * - Linux: ~/.local/share/vibe-kanban
 * - Windows: %APPDATA%\vibe-kanban
 */
export async function assetDir(): Promise<string> {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  let assetPath: string;
  
  if (isDevelopment) {
    // Development: use dev_assets relative to project root (matching Rust)
    // Since we're in backend/ directory, go up two levels to reach project root
    const projectRoot = path.join(__dirname, '..', '..', '..');
    assetPath = path.join(projectRoot, 'dev_assets');
  } else {
    // Production: use OS-appropriate app data directory
    const homeDir = os.homedir();
    
    switch (process.platform) {
      case 'darwin': // macOS
        assetPath = path.join(homeDir, 'Library', 'Application Support', 'ai.bloop.vibe-kanban');
        break;
      case 'linux':
        // Respect XDG_DATA_HOME or default to ~/.local/share (matching Rust)
        const xdgDataHome = process.env.XDG_DATA_HOME;
        if (xdgDataHome) {
          assetPath = path.join(xdgDataHome, 'ai.bloop.vibe-kanban');
        } else {
          assetPath = path.join(homeDir, '.local', 'share', 'ai.bloop.vibe-kanban');
        }
        break;
      case 'win32': // Windows
        const appDataDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
        assetPath = path.join(appDataDir, 'ai', 'bloop', 'vibe-kanban');
        break;
      default:
        // Fallback for other platforms
        assetPath = path.join(homeDir, '.vibe-kanban');
    }
  }

  // Ensure the directory exists
  try {
    await fs.mkdir(assetPath, { recursive: true });
  } catch (error) {
    logger.error(`Failed to create asset directory ${assetPath}:`, error);
    throw new Error(`Failed to create asset directory: ${error}`);
  }

  return assetPath;
}

/**
 * Get the config file path
 */
export async function configPath(): Promise<string> {
  const assetDirPath = await assetDir();
  return path.join(assetDirPath, 'config.json');
}

/**
 * Get the profiles file path
 */
export async function profilesPath(): Promise<string> {
  const assetDirPath = await assetDir();
  return path.join(assetDirPath, 'profiles.json');
}

/**
 * Get the database file path
 */
export async function databasePath(): Promise<string> {
  const assetDirPath = await assetDir();
  return path.join(assetDirPath, 'db.sqlite');
}

/**
 * Get path for logs directory
 */
export async function logsDir(): Promise<string> {
  const assetDirPath = await assetDir();
  const logsPath = path.join(assetDirPath, 'logs');
  
  try {
    await fs.mkdir(logsPath, { recursive: true });
  } catch (error) {
    logger.error(`Failed to create logs directory ${logsPath}:`, error);
    throw new Error(`Failed to create logs directory: ${error}`);
  }
  
  return logsPath;
}

/**
 * Get path for temp directory
 */
export async function tempDir(): Promise<string> {
  const assetDirPath = await assetDir();
  const tempPath = path.join(assetDirPath, 'temp');
  
  try {
    await fs.mkdir(tempPath, { recursive: true });
  } catch (error) {
    logger.error(`Failed to create temp directory ${tempPath}:`, error);
    throw new Error(`Failed to create temp directory: ${error}`);
  }
  
  return tempPath;
}

/**
 * Get path for cache directory
 */
export async function cacheDir(): Promise<string> {
  const assetDirPath = await assetDir();
  const cachePath = path.join(assetDirPath, 'cache');
  
  try {
    await fs.mkdir(cachePath, { recursive: true });
  } catch (error) {
    logger.error(`Failed to create cache directory ${cachePath}:`, error);
    throw new Error(`Failed to create cache directory: ${error}`);
  }
  
  return cachePath;
}

/**
 * Check if a file exists in the asset directory
 */
export async function assetExists(filename: string): Promise<boolean> {
  try {
    const assetDirPath = await assetDir();
    const filePath = path.join(assetDirPath, filename);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read asset file content
 */
export async function readAssetFile(filename: string): Promise<string> {
  const assetDirPath = await assetDir();
  const filePath = path.join(assetDirPath, filename);
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * Write asset file content
 */
export async function writeAssetFile(filename: string, content: string): Promise<void> {
  const assetDirPath = await assetDir();
  const filePath = path.join(assetDirPath, filename);
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Asset management for embedded content
 * TypeScript/Node.js equivalent of Rust's RustEmbed functionality
 */
export class AssetManager {
  private static soundsPath: string;
  private static scriptsPath: string;

  static async initialize(): Promise<void> {
    // Backend is in /backend, so go up one level to reach project root
    const projectRoot = path.join(process.cwd(), '..');
    this.soundsPath = path.join(projectRoot, 'assets', 'sounds');
    this.scriptsPath = path.join(projectRoot, 'assets', 'scripts');
    
    // Ensure asset directories exist
    await fs.mkdir(this.soundsPath, { recursive: true });
    await fs.mkdir(this.scriptsPath, { recursive: true });
  }

  static async listSounds(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.soundsPath);
      return files.filter(file => file.match(/\.(mp3|wav|ogg|m4a)$/i));
    } catch {
      return [];
    }
  }

  static async listScripts(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.scriptsPath);
      return files.filter(file => file.match(/\.(sh|bat|ps1)$/i));
    } catch {
      return [];
    }
  }

  static async getSoundPath(filename: string): Promise<string | null> {
    const soundPath = path.join(this.soundsPath, filename);
    try {
      await fs.access(soundPath);
      return soundPath;
    } catch {
      return null;
    }
  }

  static async getScriptPath(filename: string): Promise<string | null> {
    const scriptPath = path.join(this.scriptsPath, filename);
    try {
      await fs.access(scriptPath);
      return scriptPath;
    } catch {
      return null;
    }
  }
}
