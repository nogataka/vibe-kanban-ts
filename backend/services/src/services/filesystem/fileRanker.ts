import * as path from 'path';
import { GitService } from '../git/gitService';
import { logger } from '../../../../utils/src/logger';

export interface FileStat {
  /** Index in the commit history (0 = HEAD, 1 = parent of HEAD, ...) */
  last_index: number;
  /** Number of times this file was changed in recent commits */
  commit_count: number;
  /** Timestamp of the most recent change */
  last_time: Date;
}

export type FileStats = Map<string, FileStat>;

export enum SearchMatchType {
  FILENAME = 'filename',
  DIRECTORY_NAME = 'directory_name',
  FULL_PATH = 'full_path'
}

export interface SearchResult {
  path: string;
  match_type: SearchMatchType;
  score?: number;
}

interface RepoHistoryCache {
  head_sha: string;
  stats: FileStats;
  generated_at: Date;
}

/** Configuration constants for ranking algorithm */
const DEFAULT_COMMIT_LIMIT = 100;
const BASE_MATCH_SCORE_FILENAME = 100;
const BASE_MATCH_SCORE_DIRNAME = 10;
const BASE_MATCH_SCORE_FULLPATH = 1;
const RECENCY_WEIGHT = 2;
const FREQUENCY_WEIGHT = 1;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class FileRanker {
  private gitService: GitService;
  private cache: Map<string, RepoHistoryCache> = new Map();

  constructor() {
    this.gitService = new GitService();
  }

  /**
   * Get file statistics for a repository, using cache when possible
   */
  async getStats(repoPath: string): Promise<FileStats> {
    const normalizedPath = path.resolve(repoPath);
    
    // Check if we have a valid cache entry
    const cacheEntry = this.cache.get(normalizedPath);
    if (cacheEntry) {
      // Check if cache is still fresh
      const age = Date.now() - cacheEntry.generated_at.getTime();
      if (age < CACHE_TTL_MS) {
        try {
          // Verify cache is still valid by checking HEAD
          const headInfo = await this.gitService.getHeadInfo(normalizedPath);
          if (headInfo?.oid === cacheEntry.head_sha) {
            return cacheEntry.stats;
          }
        } catch (error) {
          logger.debug(`Failed to verify cache for ${normalizedPath}:`, error);
        }
      }
    }

    // Cache miss or invalid - compute new stats
    return await this.computeStats(normalizedPath);
  }

  /**
   * Re-rank search results based on git history statistics
   */
  rerank(results: SearchResult[], stats: FileStats): SearchResult[] {
    const rankedResults = results.map(result => ({
      ...result,
      score: this.calculateScore(result, stats)
    }));

    // Sort by score (higher scores first)
    rankedResults.sort((a, b) => (b.score || 0) - (a.score || 0));

    return rankedResults;
  }

  /**
   * Calculate relevance score for a search result
   */
  private calculateScore(result: SearchResult, stats: FileStats): number {
    let baseScore: number;
    
    switch (result.match_type) {
      case SearchMatchType.FILENAME:
        baseScore = BASE_MATCH_SCORE_FILENAME;
        break;
      case SearchMatchType.DIRECTORY_NAME:
        baseScore = BASE_MATCH_SCORE_DIRNAME;
        break;
      case SearchMatchType.FULL_PATH:
        baseScore = BASE_MATCH_SCORE_FULLPATH;
        break;
      default:
        baseScore = BASE_MATCH_SCORE_FULLPATH;
    }

    const stat = stats.get(result.path);
    if (stat) {
      const recencyBonus = (100 - Math.min(stat.last_index, 99)) * RECENCY_WEIGHT;
      const frequencyBonus = stat.commit_count * FREQUENCY_WEIGHT;

      // Multiply base score to maintain hierarchy, add git-based bonuses
      return baseScore * 1000 + recencyBonus * 10 + frequencyBonus;
    } else {
      // Files not in git history get base score only
      return baseScore * 1000;
    }
  }

  /**
   * Compute file statistics from git history
   */
  private async computeStats(repoPath: string): Promise<FileStats> {
    try {
      const stats = await this.gitService.collectRecentFileStats(repoPath, DEFAULT_COMMIT_LIMIT);
      const headInfo = await this.gitService.getHeadInfo(repoPath);

      // Update cache
      if (headInfo?.oid) {
        this.cache.set(repoPath, {
          head_sha: headInfo.oid,
          stats,
          generated_at: new Date()
        });
      }

      return stats;
    } catch (error) {
      logger.warn(`Failed to collect file stats for ${repoPath}:`, error);
      // Return empty stats on error - search will still work without ranking
      return new Map();
    }
  }

  /**
   * Clear cache for a specific repository or all repositories
   */
  clearCache(repoPath?: string): void {
    if (repoPath) {
      const normalizedPath = path.resolve(repoPath);
      this.cache.delete(normalizedPath);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheInfo(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}
