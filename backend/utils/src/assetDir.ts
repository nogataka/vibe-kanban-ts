import { homedir } from 'os';
import { platform } from 'process';
import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

/**
 * Get the asset directory path, matching Rust's implementation
 * Development: dev_assets/
 * Production: OS-specific application data directory
 */
export function getAssetDir(): string {
  let path: string;
  
  // Check if we're in development mode (similar to Rust's debug_assertions)
  const isDevelopment = process.env.NODE_ENV === 'development' || 
                        process.env.NODE_ENV === undefined ||
                        process.env.NODE_ENV === 'test';
  
  if (isDevelopment) {
    // Use dev_assets directory in development (matching Rust)
    // Resolve to project root's dev_assets
    path = resolve(__dirname, '..', '..', '..', 'dev_assets');
  } else {
    // Use OS-specific directory in production
    switch (platform) {
      case 'darwin': // macOS
        path = join(homedir(), 'Library', 'Application Support', 'ai.bloop.vibe-kanban');
        break;
      case 'linux':
        // Check for XDG_DATA_HOME first
        const xdgDataHome = process.env.XDG_DATA_HOME;
        if (xdgDataHome) {
          path = join(xdgDataHome, 'ai.bloop.vibe-kanban');
        } else {
          path = join(homedir(), '.local', 'share', 'ai.bloop.vibe-kanban');
        }
        break;
      case 'win32': // Windows
        const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
        path = join(appData, 'ai', 'bloop', 'vibe-kanban');
        break;
      default:
        // Fallback to home directory
        path = join(homedir(), '.vibe-kanban');
    }
  }
  
  // Ensure the directory exists
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  
  return path;
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return join(getAssetDir(), 'config.json');
}

/**
 * Get the database file path
 */
export function getDatabasePath(): string {
  const isDevelopment = process.env.NODE_ENV === 'development' || 
                        process.env.NODE_ENV === undefined ||
                        process.env.NODE_ENV === 'test';
  
  // Rust uses db.sqlite in dev_assets
  const dbName = isDevelopment ? 'db.sqlite' : 'vibe-kanban.db';
  return join(getAssetDir(), dbName);
}

/**
 * Get the profiles file path
 */
export function getProfilesPath(): string {
  return join(getAssetDir(), 'profiles.json');
}

/**
 * Get the cache directory path
 */
export function getCacheDir(): string {
  const cacheDir = join(getAssetDir(), 'cache');
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}