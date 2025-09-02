// Base types and enums
export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'inprogress', 
  IN_REVIEW = 'inreview',
  DONE = 'done',
  CANCELLED = 'cancelled'
}

export enum ExecutionProcessStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  KILLED = 'killed'
}

export enum ExecutionProcessRunReason {
  SETUP_SCRIPT = 'setupscript',
  CLEANUP_SCRIPT = 'cleanupscript', 
  CODING_AGENT = 'codingagent',
  DEV_SERVER = 'devserver'
}

export enum MergeType {
  DIRECT = 'direct',
  PR = 'pr'
}

export enum PRStatus {
  OPEN = 'open',
  MERGED = 'merged',
  CLOSED = 'closed'
}

// Project types
export interface Project {
  id: string;
  name: string;
  git_repo_path: string;
  setup_script?: string;
  dev_script?: string;
  cleanup_script?: string;
  copy_files?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProject {
  name: string;
  git_repo_path: string;
  use_existing_repo: boolean;
  setup_script?: string;
  dev_script?: string;
  cleanup_script?: string;
  copy_files?: string;
}

export interface UpdateProject {
  name?: string;
  git_repo_path?: string;
  setup_script?: string;
  dev_script?: string;
  cleanup_script?: string;
  copy_files?: string;
}

export interface ProjectWithBranch extends Project {
  current_branch?: string;
}

// Task types
export interface Task {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  parent_task_attempt?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TaskWithAttemptStatus extends Task {
  has_in_progress_attempt: boolean;
  has_merged_attempt: boolean;
  last_attempt_failed: boolean;
  profile: string;
}

export interface CreateTask {
  project_id: string;
  title: string;
  description?: string;
  parent_task_attempt?: string;
  image_ids?: string[];
}

export interface UpdateTask {
  title?: string;
  description?: string;
  status?: TaskStatus;
  parent_task_attempt?: string;
  image_ids?: string[];
}

// TaskAttempt types
export interface TaskAttempt {
  id: string;
  task_id: string;
  container_ref?: string; // Path to a worktree (local), or cloud container id
  branch?: string; // Git branch name for this task attempt
  base_branch: string; // Base branch this attempt is based on
  profile: string; // Name of the base coding agent profile
  worktree_deleted: boolean; // Flag indicating if worktree has been cleaned up
  setup_completed_at?: Date; // When setup script was last completed
  created_at: Date;
  updated_at: Date;
}

export interface CreateTaskAttempt {
  profile: string;
  base_branch: string;
}

export interface CreateFollowUpAttempt {
  prompt: string;
}

export interface TaskAttemptContext {
  task_attempt: TaskAttempt;
  task: Task;
  project: Project;
}

// ExecutionProcess types
export interface ExecutorActionField {
  // This would contain the actual executor action data structure
  // For now, using any - will be refined when implementing executors
  [key: string]: any;
}

export interface ExecutionProcess {
  id: string;
  task_attempt_id: string;
  run_reason: ExecutionProcessRunReason;
  executor_action: ExecutorActionField;
  status: ExecutionProcessStatus;
  exit_code?: number;
  started_at: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateExecutionProcess {
  task_attempt_id: string;
  executor_action: ExecutorActionField;
  run_reason: ExecutionProcessRunReason;
}

export interface UpdateExecutionProcess {
  status?: ExecutionProcessStatus;
  exit_code?: number;
  completed_at?: Date;
}

export interface ExecutionContext {
  execution_process: ExecutionProcess;
  task_attempt: TaskAttempt;
  task: Task;
}

// ExecutorSession types
export interface ExecutorSession {
  id: string;
  task_attempt_id: string;
  execution_process_id: string;
  session_id?: string; // External session ID from Claude/Amp
  prompt?: string; // The prompt sent to the executor
  summary?: string; // Final assistant message/summary
  created_at: Date;
  updated_at: Date;
}

export interface CreateExecutorSession {
  task_attempt_id: string;
  execution_process_id: string;
  prompt?: string;
}

export interface UpdateExecutorSession {
  session_id?: string;
  prompt?: string;
  summary?: string;
}

// ExecutionProcessLogs types
export interface ExecutionProcessLogs {
  execution_id: string;
  logs: string; // JSONL format (one LogMsg per line)
  byte_size: number;
  inserted_at: Date;
}

// TaskTemplate types
export interface TaskTemplate {
  id: string;
  project_id?: string; // NULL for global templates
  title: string;
  description?: string;
  template_name: string; // Display name for the template
  created_at: Date;
  updated_at: Date;
}

export interface CreateTaskTemplate {
  project_id?: string;
  title: string;
  description?: string;
  template_name: string;
}

export interface UpdateTaskTemplate {
  title?: string;
  description?: string;
  template_name?: string;
}

// Image types
export interface Image {
  id: string;
  file_path: string; // relative path within cache/images/
  original_name: string;
  mime_type?: string;
  size_bytes?: number;
  hash: string; // SHA256 for deduplication
  created_at: Date;
  updated_at: Date;
}

export interface TaskImage {
  id: string;
  task_id: string;
  image_id: string;
  created_at: Date;
}

// Merge types
export interface Merge {
  id: string;
  task_attempt_id: string;
  merge_type: MergeType;
  
  // Direct merge fields (NULL for PR merges)
  merge_commit?: string;
  
  // PR merge fields (NULL for direct merges)
  pr_number?: number;
  pr_url?: string;
  pr_status?: PRStatus;
  pr_merged_at?: Date;
  pr_merge_commit_sha?: string;
  
  created_at: Date;
  target_branch_name: string;
}

// Search and utility types
export interface SearchResult {
  path: string;
  is_file: boolean;
  match_type: SearchMatchType;
}

export enum SearchMatchType {
  FILE_NAME = 'FileName',
  DIRECTORY_NAME = 'DirectoryName',
  FULL_PATH = 'FullPath'
}

// Error types
export class ProjectError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export class TaskAttemptError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'TaskAttemptError';
  }
}

// GitHub PR creation parameters
export interface CreatePrParams {
  attempt_id: string;
  task_id: string;
  project_id: string;
  github_token: string;
  title: string;
  body?: string;
  base_branch?: string;
}

// Context data for resume operations
export interface AttemptResumeContext {
  execution_history: string;
  cumulative_diffs: string;
}
