import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../../../utils/src/logger';

export interface DirectoryEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_git_repo: boolean;
  last_modified?: number;
}

export interface DirectoryListResponse {
  entries: DirectoryEntry[];
  current_path: string;
}

export class FilesystemError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'FilesystemError';
  }
}

export class FilesystemService {
  constructor() {}

  /**
   * List Git repositories in a given directory with optional max depth
   */
  async listGitRepos(
    basePath?: string,
    maxDepth?: number
  ): Promise<DirectoryEntry[]> {
    const searchPath = basePath ? path.resolve(basePath) : this.getHomeDirectory();
    await this.verifyDirectory(searchPath);

    const gitRepos: DirectoryEntry[] = [];
    await this.findGitRepos(searchPath, gitRepos, 0, maxDepth || 3);

    // Sort by last modified (newest first)
    gitRepos.sort((a, b) => (b.last_modified || 0) - (a.last_modified || 0));
    
    return gitRepos;
  }

  /**
   * Recursively find Git repositories
   */
  private async findGitRepos(
    currentPath: string,
    gitRepos: DirectoryEntry[],
    currentDepth: number,
    maxDepth: number
  ): Promise<void> {
    if (currentDepth > maxDepth) {
      return;
    }

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const entryPath = path.join(currentPath, entry.name);
        
        // Skip hidden directories except for inspection
        if (entry.name.startsWith('.') && entry.name !== '.git') {
          continue;
        }

        // Check if this directory is a Git repository
        const gitPath = path.join(entryPath, '.git');
        try {
          const gitStat = await fs.stat(gitPath);
          if (gitStat.isDirectory()) {
            // This is a Git repository
            const stats = await fs.stat(entryPath);
            gitRepos.push({
              name: entry.name,
              path: entryPath,
              is_directory: true,
              is_git_repo: true,
              last_modified: Math.floor(stats.mtime.getTime() / 1000)
            });
          }
        } catch {
          // Not a Git repository, continue searching recursively
          if (currentDepth < maxDepth) {
            await this.findGitRepos(entryPath, gitRepos, currentDepth + 1, maxDepth);
          }
        }
      }
    } catch (error) {
      // Log error but continue search
      logger.debug(`Error searching directory ${currentPath}:`, error);
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath?: string): Promise<DirectoryListResponse> {
    const targetPath = dirPath ? path.resolve(dirPath) : this.getHomeDirectory();
    await this.verifyDirectory(targetPath);

    try {
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const directoryEntries: DirectoryEntry[] = [];

      for (const entry of entries) {
        // Skip hidden files/directories except '..'
        if (entry.name.startsWith('.') && entry.name !== '..') {
          continue;
        }

        const entryPath = path.join(targetPath, entry.name);
        const isDirectory = entry.isDirectory();
        
        let isGitRepo = false;
        if (isDirectory) {
          try {
            const gitPath = path.join(entryPath, '.git');
            const gitStat = await fs.stat(gitPath);
            isGitRepo = gitStat.isDirectory();
          } catch {
            // Not a Git repository
            isGitRepo = false;
          }
        }

        directoryEntries.push({
          name: entry.name,
          path: entryPath,
          is_directory: isDirectory,
          is_git_repo: isGitRepo,
        });
      }

      // Sort: directories first, then files, both alphabetically
      directoryEntries.sort((a, b) => {
        if (a.is_directory && !b.is_directory) return -1;
        if (!a.is_directory && b.is_directory) return 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      return {
        entries: directoryEntries,
        current_path: targetPath
      };
    } catch (error) {
      throw new FilesystemError(
        `Failed to read directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'IO_ERROR'
      );
    }
  }

  /**
   * Get the user's home directory
   */
  private getHomeDirectory(): string {
    const homeDir = os.homedir();
    
    // Fallback paths if home directory is not available
    if (!homeDir) {
      if (process.platform === 'win32') {
        return process.env.USERPROFILE || 'C:\\';
      } else {
        return '/';
      }
    }
    
    return homeDir;
  }

  /**
   * Verify that a path exists and is a directory
   */
  private async verifyDirectory(dirPath: string): Promise<void> {
    try {
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        throw new FilesystemError('Path is not a directory', 'PATH_NOT_DIRECTORY');
      }
    } catch (error) {
      if (error instanceof FilesystemError) {
        throw error;
      }
      throw new FilesystemError('Directory does not exist', 'DIRECTORY_NOT_EXISTS');
    }
  }

  /**
   * Check if a path exists
   */
  async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file/directory information
   */
  async getPathInfo(filePath: string): Promise<{
    exists: boolean;
    isDirectory: boolean;
    isFile: boolean;
    size?: number;
    lastModified?: Date;
  }> {
    try {
      const stats = await fs.stat(filePath);
      return {
        exists: true,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        lastModified: stats.mtime
      };
    } catch {
      return {
        exists: false,
        isDirectory: false,
        isFile: false
      };
    }
  }

  /**
   * Create directory recursively
   */
  async createDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      throw new FilesystemError(
        `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_DIRECTORY_ERROR'
      );
    }
  }

  /**
   * Read file contents as text
   */
  async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    try {
      return await fs.readFile(filePath, encoding);
    } catch (error) {
      throw new FilesystemError(
        `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'READ_FILE_ERROR'
      );
    }
  }

  /**
   * Write file contents
   */
  async writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): Promise<void> {
    try {
      await fs.writeFile(filePath, content, encoding);
    } catch (error) {
      throw new FilesystemError(
        `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WRITE_FILE_ERROR'
      );
    }
  }

  /**
   * Delete file or directory
   */
  async deletePath(filePath: string, recursive: boolean = false): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        await fs.rmdir(filePath, { recursive });
      } else {
        await fs.unlink(filePath);
      }
    } catch (error) {
      throw new FilesystemError(
        `Failed to delete path: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_PATH_ERROR'
      );
    }
  }
}
