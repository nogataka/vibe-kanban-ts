export { GitService, GitServiceError } from './gitService';
export { GitCli, GitCliError, ChangeType } from './gitCli';
export type { 
  GitBranch, 
  HeadInfo, 
  GitRepoInfo, 
  DiffTarget, 
  Diff, 
  FileDiffDetails, 
  DiffChangeKind 
} from './gitService';
export type { StatusDiffEntry, StatusDiffOptions } from './gitCli';
