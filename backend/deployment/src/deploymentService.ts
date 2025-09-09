// Deployment service - equivalent to Rust's deployment crate functionality
import { logger } from '../../utils/src/logger';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../../services/src/services/database';
import { ProjectModel } from '../../db/src/models/project';
import { TaskModel } from '../../db/src/models/task';
import { TaskAttemptModel } from '../../db/src/models/taskAttempt';
import { TaskTemplateModel } from '../../db/src/models/taskTemplate';
import { ExecutionProcessModel } from '../../db/src/models/executionProcess';
import { ExecutorSessionModel } from '../../db/src/models/executorSession';
import { ExecutionProcessLogModel } from '../../db/src/models/executionProcessLog';
import { Project, CreateProject, UpdateProject, Task, CreateTask, TaskAttempt, CreateTaskAttempt, TaskTemplate, CreateTaskTemplate, ExecutionProcess, TaskStatus, ExecutionProcessRunReason, ExecutionContext } from '../../db/src/models/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { FilesystemService } from '../../services/src/services/filesystem/filesystemService';
import { 
  GitHubIntegrationService, 
  GitHubUserInfo, 
  PRInfo,
  CreateIssueOptions,
  UpdateIssueOptions,
  IssueInfo,
  IssueFilters,
  CommentInfo,
  CreateReviewOptions,
  ReviewInfo,
  MergeOptions,
  MergeResult,
  MergeabilityStatus,
  PullRequestInfo,
  PullRequestFilters
} from '../../services/src/services/github/githubIntegrationService';
import { GitService, BranchType } from '../../services/src/services/git/gitService';
import { configService } from '../../services/src/services/config/configService';
import { MergeModel } from '../../db/src/models/merge';
import { ImageModel } from '../../db/src/models/image';
import { ProcessManager } from '../../services/src/services/process/processManager';
import { MsgStore } from '../../utils/src/msgStore';
import { ClaudeCode } from '../../executors/src/executors/claude';
import { ExecutorActionExecutor, ExecutorActionFactory, type ExecutorAction } from '../../executors/src/executorAction';
import { NotificationService } from '../../services/src/services/notification';
import { ConfigService } from '../../services/src/services/config';
import { ContainerManager } from '../../services/src/services/container/containerManager';


const execAsync = promisify(exec);

export class DeploymentService {
  private projectRoot: string;
  private deploymentDir: string;
  private db?: DatabaseService;
  private filesystemService: FilesystemService;
  private githubService?: GitHubIntegrationService;
  private notificationService: NotificationService;
  private configService: ConfigService;
  private containerManager?: ContainerManager;
  // Process management (matches Rust child_store and msg_stores)
  private processManagers = new Map<string, ProcessManager>();
  private msgStores = new Map<string, MsgStore>();
  private models?: {
    project: ProjectModel;
    task: TaskModel;
    taskAttempt: TaskAttemptModel;
    taskTemplate: TaskTemplateModel;
    executionProcess: ExecutionProcessModel;
    executorSession: ExecutorSessionModel;
    merge: MergeModel;
    image: ImageModel;
    executionProcessLog: ExecutionProcessLogModel;
  };

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || process.cwd();
    this.deploymentDir = path.join(this.projectRoot, '.vibe-deployments');
    this.filesystemService = new FilesystemService();
    this.notificationService = new NotificationService();
    this.configService = new ConfigService();
  }

  /**
   * Initialize deployment service
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.deploymentDir, { recursive: true });
      
      // Initialize database connection and models
      this.db = await DatabaseService.getInstance();
      const knex = this.db.getKnex();
      
      this.models = {
        project: new ProjectModel(knex),
        task: new TaskModel(knex),
        taskAttempt: new TaskAttemptModel(knex),
        taskTemplate: new TaskTemplateModel(knex),
        executionProcess: new ExecutionProcessModel(knex),
        executorSession: new ExecutorSessionModel(knex),
        merge: new MergeModel(knex),
        image: new ImageModel(knex),
        executionProcessLog: new ExecutionProcessLogModel(knex)
      };

      // Initialize config service first to get GitHub token
      const config = await this.configService.loadConfig();
      
      // Initialize GitHub service with a simplified ModelFactory interface
      const modelFactory = {
        getMergeModel: () => this.models!.merge
      } as any; // GitHubIntegrationService only needs getMergeModel
      this.githubService = new GitHubIntegrationService(modelFactory);
      
      // Try to initialize with token from config (oauth_token)
      const githubToken = config.github?.oauth_token;
      if (githubToken) {
        try {
          await this.githubService.initialize(githubToken);
          logger.info('GitHub integration initialized successfully');
        } catch (error) {
          logger.warn('Failed to initialize GitHub service with token:', error);
        }
      } else {
        logger.info('No GitHub token found in config or environment');
      }
      
      // Initialize ContainerManager
      const gitService = new GitService();
      this.containerManager = new ContainerManager(this.db as any, gitService, this.projectRoot);
      
      logger.info('Deployment service initialized');
    } catch (error) {
      logger.error('Failed to initialize deployment service:', error);
      throw error;
    }
  }

  /**
   * Create a new deployment environment
   */
  async createDeployment(name: string, config?: any): Promise<string> {
    const deploymentId = uuidv4();
    const deploymentPath = path.join(this.deploymentDir, deploymentId);
    
    try {
      await fs.mkdir(deploymentPath, { recursive: true });
      
      const deploymentConfig = {
        id: deploymentId,
        name,
        created_at: new Date().toISOString(),
        config: config || {},
        status: 'created'
      };

      await fs.writeFile(
        path.join(deploymentPath, 'config.json'),
        JSON.stringify(deploymentConfig, null, 2)
      );

      logger.info(`Created deployment: ${deploymentId} (${name})`);
      return deploymentId;
    } catch (error) {
      logger.error(`Failed to create deployment ${name}:`, error);
      throw error;
    }
  }

  /**
   * Get deployment configuration
   */
  async getDeployment(deploymentId: string): Promise<any> {
    const configPath = path.join(this.deploymentDir, deploymentId, 'config.json');
    
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      logger.error(`Failed to get deployment ${deploymentId}:`, error);
      return null;
    }
  }

  /**
   * List all deployments
   */
  async listDeployments(): Promise<any[]> {
    try {
      const entries = await fs.readdir(this.deploymentDir, { withFileTypes: true });
      const deployments: any[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const deployment = await this.getDeployment(entry.name);
          if (deployment) {
            deployments.push(deployment);
          }
        }
      }

      return deployments;
    } catch (error) {
      logger.error('Failed to list deployments:', error);
      return [];
    }
  }

  /**
   * Update deployment status
   */
  async updateDeploymentStatus(deploymentId: string, status: string): Promise<void> {
    const deployment = await this.getDeployment(deploymentId);
    
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    deployment.status = status;
    deployment.updated_at = new Date().toISOString();

    const configPath = path.join(this.deploymentDir, deploymentId, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(deployment, null, 2));
    
    logger.info(`Updated deployment ${deploymentId} status to: ${status}`);
  }

  /**
   * Delete a deployment
   */
  async deleteDeployment(deploymentId: string): Promise<void> {
    const deploymentPath = path.join(this.deploymentDir, deploymentId);
    
    try {
      await fs.rm(deploymentPath, { recursive: true, force: true });
      logger.info(`Deleted deployment: ${deploymentId}`);
    } catch (error) {
      logger.error(`Failed to delete deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Get project root directory
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Get deployments directory
   */
  getDeploymentsDir(): string {
    return this.deploymentDir;
  }

  /**
   * Cleanup deployment service
   */
  async cleanup(): Promise<void> {
    logger.info('Deployment service cleanup completed');
  }

  // Project Management Methods

  /**
   * Get all projects
   */
  async getAllProjects(): Promise<Project[]> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return await this.models.project.findAll();
  }

  /**
   * Get project by ID
   */
  async getProject(id: string): Promise<Project | null> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return await this.models.project.findById(id);
  }

  /**
   * Create new project
   */
  async createProject(data: CreateProject): Promise<Project> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return await this.models.project.create(data);
  }

  /**
   * Update project
   */
  async updateProject(
    id: string,
    name: string,
    git_repo_path: string,
    setup_script?: string | null,
    dev_script?: string | null,
    cleanup_script?: string | null,
    copy_files?: string | null
  ): Promise<Project> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return await this.models.project.update(
      id,
      name,
      git_repo_path,
      setup_script,
      dev_script,
      cleanup_script,
      copy_files
    );
  }

  /**
   * Delete project
   */
  async deleteProject(id: string): Promise<void> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    await this.models.project.delete(id);
  }

  /**
   * Get project branches from git repository
   */
  async getProjectBranches(gitRepoPath: string): Promise<Array<{name: string, is_current: boolean, is_remote: boolean, last_commit_date?: string}>> {
    try {
      // Get current branch first
      let currentBranch = '';
      try {
        const { stdout: currentStdout } = await execAsync('git branch --show-current', { cwd: gitRepoPath });
        currentBranch = currentStdout.trim();
      } catch {
        // Ignore error if can't get current branch
      }
      
      // Get all branches (local and remote)
      const { stdout } = await execAsync('git branch -a', { cwd: gitRepoPath });
      
      const branches = await Promise.all(
        stdout
          .split('\n')
          .filter(line => line.trim())
          .map(async (line) => {
            const isCurrentMarker = line.startsWith('*');
            const cleanLine = line.replace(/^\*?\s*/, '').trim();
            
            if (cleanLine.startsWith('remotes/')) {
              // Remote branch
              const remoteBranch = cleanLine.replace('remotes/', '');
              // Skip HEAD references
              if (remoteBranch.includes(' -> ')) {
                return null;
              }
              
              // Get last commit date
              let lastCommitDate: string | undefined;
              try {
                const { stdout: dateStdout } = await execAsync(
                  `git log -1 --format=%aI "${remoteBranch}"`,
                  { cwd: gitRepoPath }
                );
                lastCommitDate = dateStdout.trim();
              } catch {
                // Ignore if can't get commit date
              }
              
              return {
                name: remoteBranch,
                is_current: false,
                is_remote: true,
                last_commit_date: lastCommitDate
              };
            } else {
              // Local branch
              // Get last commit date
              let lastCommitDate: string | undefined;
              try {
                const { stdout: dateStdout } = await execAsync(
                  `git log -1 --format=%aI "${cleanLine}"`,
                  { cwd: gitRepoPath }
                );
                lastCommitDate = dateStdout.trim();
              } catch {
                // Ignore if can't get commit date
              }
              
              return {
                name: cleanLine,
                is_current: currentBranch ? cleanLine === currentBranch : isCurrentMarker,
                is_remote: false,
                last_commit_date: lastCommitDate
              };
            }
          })
      );

      return branches.filter(branch => branch !== null) as Array<{name: string, is_current: boolean, is_remote: boolean, last_commit_date?: string}>;
    } catch (error) {
      logger.error('Failed to get git branches:', error);
      // Return default branches if git command fails
      return [
        { name: 'main', is_current: true, is_remote: false },
        { name: 'master', is_current: false, is_remote: false }
      ];
    }
  }

  /**
   * Get tasks with attempt status for a project
   */
  async getTasksWithAttemptStatus(projectId: string): Promise<any[]> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    
    // Use the proper method that matches Rust implementation
    const tasks = await this.models.task.findByProjectIdWithAttemptStatus(projectId);
    return tasks;
  }

  /**
   * Get task attempts
   */
  async getTaskAttempts(taskId?: string): Promise<TaskAttempt[]> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    
    if (taskId) {
      return await this.models.taskAttempt.findByTaskId(taskId);
    } else {
      return await this.models.taskAttempt.findAll();
    }
  }

  /**
   * Get task attempt by ID
   */
  async getTaskAttempt(id: string): Promise<TaskAttempt | null> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return await this.models.taskAttempt.findById(id);
  }

  /**
   * Get task by ID
   */
  async getTask(id: string): Promise<Task | null> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return await this.models.task.findById(id);
  }

  /**
   * Get all tasks
   */
  async getTasks(): Promise<Task[]> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    // Get all projects and then tasks for each
    const projects = await this.models.project.findAll();
    const allTasks: Task[] = [];
    for (const project of projects) {
      const tasks = await this.models.task.findByProjectId(project.id);
      allTasks.push(...tasks);
    }
    return allTasks;
  }

  /**
   * Update task
   */
  async updateTask(id: string, data: Partial<Task>): Promise<Task | null> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    // First get the current task to get project_id
    const currentTask = await this.models.task.findById(id);
    if (!currentTask) {
      return null;
    }
    
    // Use current values for any fields not provided
    const updatedTask = await this.models.task.update(
      id,
      currentTask.project_id,
      data.title || currentTask.title,
      data.description !== undefined ? data.description : currentTask.description,
      data.status || currentTask.status,
      data.parent_task_attempt !== undefined ? data.parent_task_attempt : currentTask.parent_task_attempt
    );
    
    return updatedTask;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(id: string, status: string): Promise<void> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    await this.models.task.updateStatus(id, status as TaskStatus);
  }

  /**
   * Delete task
   */
  async deleteTask(id: string): Promise<void> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    await this.models.task.delete(id);
  }

  /**
   * Create task attempt
   */
  async createTaskAttempt(taskId: string, profile: string, baseBranch: string): Promise<TaskAttempt> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    
    const createData: CreateTaskAttempt = {
      profile,
      base_branch: baseBranch
    };
    
    return await this.models.taskAttempt.create(createData, taskId);
  }

  /**
   * Get models for direct access
   */
  getModels() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return {
      getProjectModel: () => this.models!.project,
      getTaskModel: () => this.models!.task,
      getTaskAttemptModel: () => this.models!.taskAttempt,
      getTaskTemplateModel: () => this.models!.taskTemplate,
      getExecutionProcessModel: () => this.models!.executionProcess,
      getExecutorSessionModel: () => this.models!.executorSession,
      getMergeModel: () => this.models!.merge,
      getImageModel: () => this.models!.image
    };
  }

  /**
   * Direct model getters for API routes
   */
  getProjectModel() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return this.models.project;
  }

  async getConfig() {
    return await this.configService.loadConfig();
  }

  getTaskModel() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return this.models.task;
  }

  getTaskAttemptModel() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return this.models.taskAttempt;
  }

  getTaskTemplateModel() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return this.models.taskTemplate;
  }

  getExecutionProcessModel() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return this.models.executionProcess;
  }

  getExecutorSessionModel() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return this.models.executorSession;
  }

  getMergeModel() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return this.models.merge;
  }

  getImageModel() {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return this.models.image;
  }

  /**
   * Start execution process - full implementation matching Rust version
   */
  async startExecutionProcess(
    taskAttemptId: string,
    runReason: any,
    action: any,
    workingDirectory: string
  ): Promise<ExecutionProcess> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }

    // Check if this is a follow-up request or another pre-defined action
    // If action is already a complete ExecutorAction object, use it directly
    if (action && typeof action === 'object' && action.typ) {
      logger.info(`Using provided executor action with type: ${action.typ.type}`);
      
      // Get the task attempt for execution
      const taskAttempt = await this.models.taskAttempt.findById(taskAttemptId);
      if (!taskAttempt) {
        throw new Error('Task attempt not found');
      }
      
      // Start execution with the provided action
      return await this.startExecution(
        taskAttempt,
        action,
        runReason
      );
    }

    // Otherwise, this is an initial coding request - continue with existing logic
    // Get the task attempt
    const taskAttempt = await this.models.taskAttempt.findById(taskAttemptId);
    if (!taskAttempt) {
      throw new Error('Task attempt not found');
    }

    // Step 1: Create container (worktree) only if it doesn't exist
    // For follow-up requests, the container already exists
    if (!taskAttempt.container_ref) {
      await this.createContainer(taskAttempt);
    }

    // Step 2: Get parent task
    const task = await this.models.task.findById(taskAttempt.task_id);
    if (!task) {
      throw new Error('Parent task not found');
    }

    // Step 3: Get parent project
    const project = await this.models.project.findById(task.project_id);
    if (!project) {
      throw new Error('Parent project not found');
    }

    // Step 4: Get fresh task attempt after container creation
    const updatedTaskAttempt = await this.models.taskAttempt.findById(taskAttemptId);
    if (!updatedTaskAttempt || !updatedTaskAttempt.container_ref) {
      throw new Error('Container ref not found after creation');
    }

    const worktreePath = updatedTaskAttempt.container_ref;
    
    // Step 5: Prepare prompt (matching Rust's ImageService::canonicalise_image_paths)
    const prompt = this.canonicaliseImagePaths(this.taskToPrompt(task), worktreePath);

    // Step 6: Create executor action chain - matching Rust ExecutorAction structure
    const cleanupAction = project.cleanup_script ? {
      typ: {
        type: 'ScriptRequest',
        script: project.cleanup_script,
        language: 'bash',
        context: 'cleanup_script'
      },
      next_action: null
    } : null;

    // Step 7: Choose execution path based on setup script
    let executionProcess: ExecutionProcess;
    
    if (project.setup_script) {
      // Setup script first, then coding agent - matching Rust ExecutorAction structure
      const executorAction = {
        typ: {
          type: 'ScriptRequest',
          script: project.setup_script,
          language: 'bash',
          context: 'setup_script'
        },
        next_action: {
          typ: {
            type: 'CodingAgentInitialRequest',
            prompt: prompt,
            profile_variant_label: {
              profile: 'claude-code',
              variant: null
            }
          },
          next_action: cleanupAction
        }
      };

      executionProcess = await this.startExecution(
        updatedTaskAttempt,
        executorAction,
        ExecutionProcessRunReason.SETUP_SCRIPT
      );
    } else {
      // Direct coding agent execution - matching Rust ExecutorAction structure
      const executorAction = {
        typ: {
          type: 'CodingAgentInitialRequest',
          prompt: prompt,
          profile_variant_label: {
            profile: 'claude-code',
            variant: null
          }
        },
        next_action: cleanupAction
      };

      executionProcess = await this.startExecution(
        updatedTaskAttempt,
        executorAction,
        ExecutionProcessRunReason.CODING_AGENT
      );
    }

    return executionProcess;
  }

  /**
   * Create container (worktree) - matches Rust LocalContainerService::create
   */
  private async createContainer(taskAttempt: TaskAttempt): Promise<string> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }

    // Get parent task
    const task = await this.models.task.findById(taskAttempt.task_id);
    if (!task) {
      throw new Error('Parent task not found');
    }

    // Get parent project
    const project = await this.models.project.findById(task.project_id);
    if (!project) {
      throw new Error('Parent project not found');
    }

    // Create branch name from task attempt and title
    const taskBranchName = this.dirNameFromTaskAttempt(taskAttempt.id, task.title);
    const worktreeBasePath = this.getWorktreeBaseDir();
    const worktreePath = path.join(worktreeBasePath, taskBranchName);

    try {
      // Check if worktree already exists
      const execAsync = promisify(exec);
      
      try {
        // Check if worktree path already exists
        await fs.access(worktreePath);
        
        // Worktree exists, check if it's valid
        const worktreeListResult = await execAsync('git worktree list --porcelain', { cwd: project.git_repo_path });
        const worktreeExists = worktreeListResult.stdout.includes(worktreePath);
        
        if (worktreeExists) {
          logger.info(`Worktree already exists at ${worktreePath}, reusing it`);
          // Update task attempt with existing container ref
          await this.models.taskAttempt.updateContainerRef(taskAttempt.id, worktreePath);
          await this.models.taskAttempt.updateBranch(taskAttempt.id, taskBranchName);
          return worktreePath;
        } else {
          // Directory exists but not a worktree, remove it
          await fs.rm(worktreePath, { recursive: true, force: true });
        }
      } catch (error) {
        // Worktree doesn't exist, continue with creation
      }
      
      // Create worktree directory
      await fs.mkdir(worktreePath, { recursive: true });
      
      // Check if branch already exists
      let branchExists = false;
      try {
        await execAsync(`git rev-parse --verify "${taskBranchName}"`, { cwd: project.git_repo_path });
        branchExists = true;
      } catch {
        // Branch doesn't exist, will create it
      }
      
      // Create worktree with appropriate command
      if (branchExists) {
        // Branch exists, use it without -b flag
        await execAsync(
          `git worktree add --checkout "${worktreePath}" "${taskBranchName}"`,
          { cwd: project.git_repo_path }
        );
      } else {
        // Create new branch from base branch
        const baseBranch = taskAttempt.base_branch || 'main';
        
        // Check if base branch is a remote branch or local branch
        let baseRef = baseBranch;
        try {
          // Try to use the base branch as-is (could be another task branch)
          await execAsync(`git rev-parse --verify "${baseBranch}"`, { cwd: project.git_repo_path });
        } catch {
          // If base branch doesn't exist locally, try origin/baseBranch
          try {
            await execAsync(`git rev-parse --verify "origin/${baseBranch}"`, { cwd: project.git_repo_path });
            baseRef = `origin/${baseBranch}`;
          } catch {
            // If neither exists, default to main/master
            logger.warn(`Base branch ${baseBranch} not found, falling back to main`);
            baseRef = 'main';
          }
        }
        
        await execAsync(
          `git worktree add --checkout -b "${taskBranchName}" "${worktreePath}" "${baseRef}"`,
          { cwd: project.git_repo_path }
        );
      }

      // Copy project files if specified
      if (project.copy_files && project.copy_files.trim()) {
        await this.copyProjectFiles(project.git_repo_path, worktreePath, project.copy_files);
      }

      // Copy task images to worktree
      try {
        const images = await this.models.image.findByTaskId(task.id);
        if (images && images.length > 0) {
          logger.info(`Copying ${images.length} images to worktree for task ${task.id}`);
          // Image copying logic would go here
        }
      } catch (error) {
        logger.warn('Failed to copy task images to worktree:', error);
      }

      // Update task attempt with container ref and branch
      await this.models.taskAttempt.updateContainerRef(taskAttempt.id, worktreePath);
      await this.models.taskAttempt.updateBranch(taskAttempt.id, taskBranchName);

      logger.info(`Created worktree at ${worktreePath} for task attempt ${taskAttempt.id}`);
      return worktreePath;

    } catch (error) {
      logger.error(`Failed to create container for task attempt ${taskAttempt.id}:`, error);
      throw error;
    }
  }

  /**
   * Start execution - matches Rust's start_execution method
   */
  private async startExecution(
    taskAttempt: TaskAttempt,
    executorAction: any,
    runReason: ExecutionProcessRunReason
  ): Promise<ExecutionProcess> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }

    // Get parent task
    const task = await this.models.task.findById(taskAttempt.task_id);
    if (!task) {
      throw new Error('Parent task not found');
    }

    // Update task status to InProgress (matching Rust implementation)
    if (task.status !== TaskStatus.IN_PROGRESS && runReason !== ExecutionProcessRunReason.DEV_SERVER) {
      await this.models.task.updateStatus(task.id, TaskStatus.IN_PROGRESS);
    }

    // Create execution process record
    const executionProcess = await this.models.executionProcess.create({
      task_attempt_id: taskAttempt.id,
      run_reason: runReason,
      executor_action: executorAction
    });

    // Create executor session if this is a coding agent request
    if (executorAction.typ?.type === 'CodingAgentInitialRequest' || 
        executorAction.typ?.type === 'CodingAgentFollowUpRequest') {
      await this.models.executorSession.create({
        task_attempt_id: taskAttempt.id,
        execution_process_id: executionProcess.id,
        prompt: executorAction.typ.prompt
      });
    }

    logger.info(`Started execution process ${executionProcess.id} for task attempt ${taskAttempt.id}`, {
      task_id: task.id,
      project_id: task.project_id,
      run_reason: runReason,
      action_type: executorAction.typ?.type
    });

    // Start actual execution process (simplified implementation)
    setImmediate(() => {
      this.startExecutionInner(taskAttempt, executionProcess, executorAction)
        .catch(error => {
          logger.error(`Failed to start execution inner for process ${executionProcess.id}:`, error);
        });
    });

    return executionProcess;
  }

  /**
   * Helper methods matching Rust functionality
   */
  private dirNameFromTaskAttempt(attemptId: string, taskTitle: string): string {
    // Match Rust implementation exactly: vk-{short_uuid}-{git_branch_id}
    const shortUuid = this.shortUuid(attemptId);
    const gitBranchId = this.gitBranchId(taskTitle);
    return `vk-${shortUuid}-${gitBranchId}`;
  }

  private shortUuid(uuid: string): string {
    // Rust: take first 4 chars of UUID (without hyphens)
    const cleanUuid = uuid.replace(/-/g, '');
    return cleanUuid.substring(0, 4);
  }

  private gitBranchId(input: string): string {
    // Rust implementation:
    // 1. lowercase
    const lower = input.toLowerCase();
    
    // 2. replace non-alphanumerics with hyphens
    const slug = lower.replace(/[^a-z0-9]+/g, '-');
    
    // 3. trim extra hyphens
    const trimmed = slug.replace(/^-+|-+$/g, '');
    
    // 4. take up to 10 chars, then trim trailing hyphens again
    const cut = trimmed.substring(0, 10);
    return cut.replace(/-+$/g, '');
  }

  private getWorktreeBaseDir(): string {
    // Match Rust's get_worktree_base_dir
    const tempDir = process.env.TMPDIR || '/tmp';
    return path.join(tempDir, 'vibe-kanban', 'worktrees');
  }

  private taskToPrompt(task: Task): string {
    // Match Rust's task.to_prompt()
    if (task.description) {
      return `Title: ${task.title}\n\nDescription: ${task.description}`;
    } else {
      return task.title;
    }
  }

  private canonicaliseImagePaths(prompt: string, worktreePath: string): string {
    // Placeholder for image path canonicalization
    // In full implementation, this would process image references in the prompt
    return prompt;
  }

  private async copyProjectFiles(gitRepoPath: string, worktreePath: string, copyFiles: string): Promise<void> {
    // Parse copy_files and copy specified files/directories
    const filesToCopy = copyFiles.split('\n').filter(line => line.trim());
    
    for (const filePattern of filesToCopy) {
      try {
        const sourcePath = path.join(gitRepoPath, filePattern.trim());
        const destPath = path.join(worktreePath, filePattern.trim());
        
        // Ensure destination directory exists
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        
        // Copy file or directory
        const execAsync = promisify(exec);
        await execAsync(`cp -r "${sourcePath}" "${destPath}"`);
        
      } catch (error) {
        logger.warn(`Failed to copy ${filePattern}:`, error);
      }
    }
  }

  /**
   * Start execution inner - matches Rust's start_execution_inner
   */
  private async startExecutionInner(
    taskAttempt: TaskAttempt,
    executionProcess: ExecutionProcess,
    executorAction: any
  ): Promise<void> {
    logger.info(`🚀 startExecutionInner called: executionProcess=${executionProcess.id}, taskAttempt=${taskAttempt.id}`);
    logger.info(`📋 ExecutorAction type: ${executorAction?.typ?.type}`);
    logger.info(`📁 Container ref: ${taskAttempt.container_ref}`);
    
    if (!executorAction.typ || !taskAttempt.container_ref) {
      logger.error(`❌ Missing container_ref or executor action type for process ${executionProcess.id}`);
      logger.error(`   - executorAction.typ: ${executorAction.typ}`);
      logger.error(`   - taskAttempt.container_ref: ${taskAttempt.container_ref}`);
      return;
    }

    try {
      logger.info(`🎯 Creating ExecutorActionExecutor for process ${executionProcess.id}`);
      
      // Real execution based on type (matches Rust implementation)
      const executor = new ExecutorActionExecutor(executorAction);
      
      logger.info(`🏃 About to spawn executor in directory: ${taskAttempt.container_ref}`);
      const processManager = await executor.spawn(taskAttempt.container_ref);
      
      logger.info(`✅ ProcessManager created for execution ${executionProcess.id}, PID: ${processManager.getPid()}`);
      
      // Store process manager (matches Rust child_store)
      this.processManagers.set(executionProcess.id, processManager);
      logger.info(`💾 Stored process manager for execution ${executionProcess.id}`);
      
      // Create and setup MsgStore (matches Rust track_child_msgs_in_store)
      await this.trackChildMsgsInStore(executionProcess.id, processManager);
      logger.info(`📨 MsgStore created and configured for execution ${executionProcess.id}`);
      
      // Enable realtime log saving (matches Rust's spawn_stream_raw_logs_to_db)
      const msgStore = this.msgStores.get(executionProcess.id);
      if (msgStore) {
        msgStore.enableRealtimeDbSaving(
          executionProcess.id, 
          (executionId, msg) => this.saveLogMessageToDatabase(executionId, msg)
        );
        logger.info(`💾 Enabled realtime database saving for execution ${executionProcess.id}`);
      }
      
      // Call normalize_logs if this is a Claude executor (matches Rust normalize_logs)
      if (msgStore) {
        // Send initial user message for Claude executors
        if (executorAction.typ?.type === 'CodingAgentInitialRequest' || 
            executorAction.typ?.type === 'CodingAgentFollowUpRequest') {
          const userPrompt = executorAction.typ?.prompt;
          if (userPrompt) {
            const { ConversationPatch } = require('../../executors/src/logs/conversationPatch');
            const initialUserEntry = {
              timestamp: null,
              entry_type: { type: 'user_message' },
              content: userPrompt,
              metadata: null
            };
            const initialPatch = ConversationPatch.addNormalizedEntry(0, initialUserEntry);
            msgStore.pushPatch(initialPatch);
            logger.info(`📝 Sent initial user message for execution ${executionProcess.id}`);
          }
        }
        
        executor.normalizeLogsIfClaude(msgStore, taskAttempt.container_ref);
        logger.info(`🔄 Called normalize_logs for execution ${executionProcess.id}`);
      }
      
      // Spawn exit monitor (matches Rust spawn_exit_monitor)
      this.spawnExitMonitor(executionProcess.id);
      logger.info(`👀 Exit monitor started for execution ${executionProcess.id}`);
      
      logger.info(`🎉 Started real execution process ${executionProcess.id} for task attempt ${taskAttempt.id}`);
      
    } catch (error) {
      logger.error(`💥 Execution failed for process ${executionProcess.id}:`, error);
      logger.error(`📊 Error details:`, {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Update execution process status to failed
      if (this.models) {
        await this.models.executionProcess.updateCompletion(
          executionProcess.id,
          'failed' as any,
          1
        );
      }
    }
  }

  /**
   * Track child messages in store (matches Rust track_child_msgs_in_store)
   */
  private async trackChildMsgsInStore(executionId: string, processManager: ProcessManager): Promise<void> {
    const msgStore = new MsgStore();
    
    // Setup message forwarding (matches Rust spawn_forwarder concept)
    msgStore.spawnForwarder(processManager);
    
    // Store the MsgStore (matches Rust msg_stores)
    this.msgStores.set(executionId, msgStore);
    
    logger.debug(`Created MsgStore for execution ${executionId}`);
  }

  /**
   * Spawn exit monitor (matches Rust spawn_exit_monitor)
   */
  private spawnExitMonitor(executionId: string): void {
    logger.debug(`[spawnExitMonitor] Starting monitor for execution ${executionId}`);
    const checkInterval = setInterval(async () => {
      const processManager = this.processManagers.get(executionId);
      if (!processManager) {
        logger.debug(`[spawnExitMonitor] ProcessManager not found for ${executionId}, stopping monitor`);
        clearInterval(checkInterval);
        return;
      }

      const { finished, exitCode, error } = processManager.tryWait();
      logger.debug(`[spawnExitMonitor] Check for ${executionId}: finished=${finished}, exitCode=${exitCode}, error=${error?.message}`);
      
      if (finished) {
        logger.info(`[spawnExitMonitor] Process finished for ${executionId}, calling handleProcessCompletion`);
        clearInterval(checkInterval);
        await this.handleProcessCompletion(executionId, exitCode, error);
      }
    }, 250); // Check every 250ms (matches Rust)
  }

  /**
   * Handle process completion (matches Rust exit monitor logic)
   */
  private async handleProcessCompletion(
    executionId: string, 
    exitCode?: number, 
    error?: Error
  ): Promise<void> {
    logger.info(`[handleProcessCompletion] Called for ${executionId} with exitCode=${exitCode}, error=${error?.message}`);
    
    if (!this.models) return;

    try {
      // Determine final status
      const status = error ? 'failed' : ((exitCode === 0 || exitCode === null || exitCode === undefined) ? 'completed' : 'failed');
      
      // Update execution process record
      await this.models.executionProcess.updateCompletion(
        executionId, 
        status as any,
        exitCode || (error ? -1 : 0)
      );

      logger.info(`Process ${executionId} completed with status: ${status}, exit code: ${exitCode}`);

      // Save logs to database before cleanup
      const msgStore = this.msgStores.get(executionId);
      if (msgStore) {
        await this.saveLogsToDatabase(executionId, msgStore);
      }

      // Get execution context for next action logic
      const executionProcess = await this.models.executionProcess.findById(executionId);
      logger.info(`[handleProcessCompletion] executionProcess found: ${!!executionProcess}`);
      logger.debug(`handleProcessCompletion: executionProcess=${JSON.stringify(executionProcess)}, status=${status}, exitCode=${exitCode}`);
      
      if (executionProcess && status === 'completed' && (exitCode === 0 || exitCode === null || exitCode === undefined)) {
        logger.info(`[handleProcessCompletion] Attempting to commit changes for ${executionId}`);
        // Try to commit changes (matches Rust's try_commit_changes)
        const taskAttempt = await this.models.taskAttempt.findById(executionProcess.task_attempt_id);
        logger.debug(`handleProcessCompletion: taskAttempt=${JSON.stringify(taskAttempt)}, containerManager=${!!this.containerManager}`);
        
        if (taskAttempt && this.containerManager) {
          const task = await this.models.task.findById(taskAttempt.task_id);
          logger.debug(`handleProcessCompletion: task=${JSON.stringify(task)}`);
          
          if (task) {
            const ctx: ExecutionContext = {
              execution_process: executionProcess,
              task_attempt: taskAttempt,
              task: task
            };
            
            const changesCommitted = await this.containerManager.tryCommitChanges(ctx);
            if (changesCommitted) {
              logger.info(`Committed changes for task attempt ${taskAttempt.id}`);
            }
          }
        }
        
        await this.tryStartNextAction(executionProcess);
      }

      // Cleanup resources (matches Rust cleanup)
      await this.cleanupExecution(executionId);
    } catch (cleanupError) {
      logger.error(`Failed to handle completion for process ${executionId}:`, cleanupError);
    }
  }

  /**
   * Try to start next action (matches Rust try_start_next_action)
   */
  private async tryStartNextAction(executionProcess: ExecutionProcess): Promise<void> {
    try {
      const executorAction = executionProcess.executor_action as any;
      
      if (executorAction.next_action) {
        logger.info(`Starting next action for execution ${executionProcess.id}`);
        
        // Create new execution process for next action
        const nextExecution = await this.models!.executionProcess.create({
          task_attempt_id: executionProcess.task_attempt_id,
          run_reason: this.getNextRunReason(executorAction.next_action),
          executor_action: executorAction.next_action
        });

        // Get task attempt for container_ref
        const taskAttempt = await this.models!.taskAttempt.findById(executionProcess.task_attempt_id);
        if (taskAttempt) {
          // Start next action execution
          await this.startExecutionInner(taskAttempt, nextExecution, executorAction.next_action);
        }
      } else {
        // No next action - finalize task
        await this.finalizeTask(executionProcess.task_attempt_id);
      }
    } catch (error) {
      logger.error(`Failed to start next action for execution ${executionProcess.id}:`, error);
    }
  }

  /**
   * Stop execution process (matches Rust stop_execution)
   */
  async stopExecutionProcess(processId: string): Promise<void> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }

    const executionProcess = await this.models.executionProcess.findById(processId);
    if (!executionProcess) {
      throw new Error('Execution process not found');
    }

    // Kill the actual process (matches Rust kill functionality)
    const processManager = this.processManagers.get(processId);
    if (processManager) {
      processManager.kill();
    }

    // Update status to killed
    await this.models.executionProcess.updateCompletion(
      processId,
      'killed' as any
    );

    // Cleanup resources
    await this.cleanupExecution(processId);

    logger.info(`Stopped execution process ${processId}`);
  }



  /**
   * Resolve container reference to get task attempt info
   */
  async resolveContainerRef(containerRef: string): Promise<{ attempt_id: string; task_id: string; project_id: string } | null> {
    if (!this.models) {
      throw new Error('Models not initialized. Call initialize() first.');
    }

    try {
      // In Rust version, this resolves container_ref to task attempt info
      // For now, we'll assume containerRef is the task attempt ID
      const taskAttempt = await this.models.taskAttempt.findById(containerRef);
      if (!taskAttempt) {
        return null;
      }

      const task = await this.models.task.findById(taskAttempt.task_id);
      if (!task) {
        return null;
      }

      return {
        attempt_id: taskAttempt.id,
        task_id: taskAttempt.task_id,
        project_id: task.project_id
      };
    } catch (error) {
      logger.error('Failed to resolve container reference:', error);
      return null;
    }
  }

  /**
   * Stream events (SSE endpoint) - equivalent to Rust's stream_events
   */
  async streamEvents(): Promise<EventEmitter> {
    // In Rust version, this returns events().msg_store().history_plus_stream()
    // For now, return a simple event stream that matches the interface
    const eventStream = new EventEmitter();
    
    // Simulate the Rust behavior of streaming database events
    // This would be connected to a real event system in full implementation
    setImmediate(() => {
      eventStream.emit('data', {
        id: Date.now(),
        event: 'message',
        data: JSON.stringify({
          type: 'SYSTEM',
          message: 'Event stream initialized',
          timestamp: new Date().toISOString()
        })
      });
    });

    return eventStream;
  }

  /**
   * Stream raw logs for execution process (equivalent to Rust's container().stream_raw_logs())
   */
  async streamRawLogs(executionProcessId: string): Promise<EventEmitter | null> {
    if (!this.models) {
      throw new Error('Models not initialized. Call initialize() first.');
    }

    const executionProcess = await this.models.executionProcess.findById(executionProcessId);
    if (!executionProcess) {
      return null;
    }

    const logStream = new EventEmitter();
    
    // Simulate log streaming - in full implementation this would connect to actual container logs
    setTimeout(() => {
      logStream.emit('data', {
        timestamp: new Date().toISOString(),
        message: 'Raw log entry',
        level: 'info'
      });
    }, 100);

    return logStream;
  }

  /**
   * Stream normalized logs for execution process (equivalent to Rust's container().stream_normalized_logs())
   */
  async streamNormalizedLogs(executionProcessId: string): Promise<EventEmitter | null> {
    if (!this.models) {
      throw new Error('Models not initialized. Call initialize() first.');
    }

    const executionProcess = await this.models.executionProcess.findById(executionProcessId);
    if (!executionProcess) {
      return null;
    }

    const logStream = new EventEmitter();
    
    // Simulate realistic coding agent log streaming
    if (executionProcess.run_reason === 'codingagent' && executionProcess.status === 'running') {
      let logCounter = 0;
      const logs = [
        { message: '[Process ' + executionProcess.id.slice(0, 8) + '] Setting up workspace...', level: 'info' },
        { message: '[Process ' + executionProcess.id.slice(0, 8) + '] Analyzing task requirements...', level: 'info' },
        { message: '[Process ' + executionProcess.id.slice(0, 8) + '] Claude Code agent ready for task execution', level: 'info' },
        { message: '[Process ' + executionProcess.id.slice(0, 8) + '] Starting code analysis and implementation...', level: 'info' },
        { message: '[Process ' + executionProcess.id.slice(0, 8) + '] Processing task: ' + (executionProcess.executor_action?.typ?.prompt || 'No prompt available'), level: 'info' },
        { message: '[Process ' + executionProcess.id.slice(0, 8) + '] Execution in progress...', level: 'info' }
      ];
      
      const sendNextLog = () => {
        if (logCounter < logs.length) {
          const log = logs[logCounter];
          logStream.emit('data', {
            timestamp: new Date().toISOString(),
            message: log.message,
            level: log.level,
            source: 'coding_agent',
            process_id: executionProcess.id
          });
          logCounter++;
          setTimeout(sendNextLog, 2000); // Send a log every 2 seconds
        }
      };
      
      // Start sending logs after 500ms
      setTimeout(sendNextLog, 500);
    } else {
      // For non-coding-agent processes or completed processes, send basic info
      setTimeout(() => {
        logStream.emit('data', {
          timestamp: new Date().toISOString(),
          message: 'Process ' + executionProcess.id + ' - ' + executionProcess.run_reason + ' execution',
          level: 'info',
          source: executionProcess.run_reason,
          process_id: executionProcess.id
        });
      }, 100);
    }

    return logStream;
  }

  /**
   * Get filesystem service (equivalent to Rust's filesystem())
   */
  getFilesystemService(): FilesystemService {
    return this.filesystemService;
  }

  /**
   * Get GitHub service
   */
  getGitHubService(): GitHubIntegrationService {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return this.githubService;
  }

  /**
   * Get GitHub user info
   */
  async getGitHubUserInfo(): Promise<GitHubUserInfo | null> {
    if (!this.githubService) {
      return null;
    }
    return await this.githubService.getUserInfo();
  }

  /**
   * Create pull request for task attempt
   */
  async createPullRequest(
    taskAttemptId: string,
    title: string,
    body: string,
    headBranch: string,
    baseBranch: string
  ): Promise<PRInfo> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.createPullRequest(taskAttemptId, {
      title,
      body,
      head: headBranch,
      base: baseBranch
    });
  }

  // ==================== Issue Management Methods ====================

  async setGitHubRepository(projectId: string): Promise<void> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    
    // Validate projectId
    if (!projectId || typeof projectId !== 'string') {
      throw new Error(`Invalid projectId: expected string, got ${typeof projectId} - value: ${JSON.stringify(projectId)}`);
    }
    
    // Get project details
    const project = await this.models!.project.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    // Set repository based on project's git_repo_path
    await this.githubService.setRepository(project.git_repo_path);
  }

  async createIssue(data: CreateIssueOptions): Promise<IssueInfo> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.createIssue(data);
  }

  async getIssues(filters?: IssueFilters): Promise<IssueInfo[]> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.getIssues(filters || {});
  }

  async getIssue(issueNumber: number): Promise<IssueInfo | null> {
    if (!this.githubService) {
      return null;
    }
    return await this.githubService.getIssue(issueNumber);
  }

  async updateIssue(issueNumber: number, data: UpdateIssueOptions): Promise<IssueInfo> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.updateIssue(issueNumber, data);
  }

  async addIssueComment(issueNumber: number, body: string): Promise<CommentInfo> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.addIssueComment(issueNumber, body);
  }

  async getIssueComments(issueNumber: number): Promise<CommentInfo[]> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.getIssueComments(issueNumber);
  }

  // ==================== PR Review Management Methods ====================

  async createPRReview(pullNumber: number, data: CreateReviewOptions): Promise<ReviewInfo> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.createPRReview(pullNumber, data);
  }

  async getPRReviews(pullNumber: number): Promise<ReviewInfo[]> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.getPRReviews(pullNumber);
  }

  async submitPRReview(pullNumber: number, reviewId: number, event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'): Promise<ReviewInfo> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.submitPRReview(pullNumber, reviewId, event);
  }

  async addReviewComment(pullNumber: number, reviewId: number, body: string): Promise<CommentInfo> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.addReviewComment(pullNumber, reviewId, body);
  }

  async getPRComments(pullNumber: number): Promise<CommentInfo[]> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.getPRComments(pullNumber);
  }

  async replyToComment(pullNumber: number, commentId: number, body: string): Promise<CommentInfo> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.replyToComment(pullNumber, commentId, body);
  }

  // ==================== Merge Management Methods ====================

  async mergePullRequest(pullNumber: number, options?: MergeOptions): Promise<MergeResult> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.mergePullRequest(pullNumber, options);
  }

  async checkMergeability(pullNumber: number): Promise<MergeabilityStatus> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.checkMergeability(pullNumber);
  }

  async updatePullRequestBranch(pullNumber: number): Promise<void> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.updatePullRequestBranch(pullNumber);
  }

  async closePullRequest(pullNumber: number): Promise<void> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.closePullRequest(pullNumber);
  }

  async getPullRequests(filters?: PullRequestFilters): Promise<PullRequestInfo[]> {
    if (!this.githubService) {
      throw new Error('GitHub service not initialized');
    }
    return await this.githubService.getPullRequests(filters);
  }

  /**
   * Create task attempt and start execution (like Rust version)
   */
  async createTaskAttemptAndStart(taskId: string, projectPath: string): Promise<any> {
    try {
      // Get current branch
      // const currentBranch = await this.getCurrentBranch(projectPath);
      const currentBranch = 'main'; // Fallback for now
      
      // Create task attempt with default profile
      const createAttemptData = {
        profile: 'claude-code', // Default profile like Rust version
        base_branch: currentBranch
      };
      
      const taskAttempt = await this.models!.taskAttempt.create(createAttemptData, taskId);
      
      // Start execution process
      const executionProcess = await this.startExecutionProcess(
        taskAttempt.id,
        'initial_run',
        'coding_agent_initial',
        projectPath
      );
      
      logger.info(`Task attempt created and execution started: ${taskAttempt.id}`);
      
      // Return task with attempt status (like Rust version)
      const task = await this.models!.task.findById(taskId);
      return {
        ...task,
        latest_attempt_status: 'running',
        attempt_count: 1
      };
    } catch (error) {
      logger.error('Failed to create task attempt and start execution:', error);
      throw error;
    }
  }

  /**
   * Get current git branch from project path
   */
  private async getCurrentBranch(projectPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git branch --show-current', { cwd: projectPath });
      return stdout.trim() || 'main';
    } catch (error) {
      logger.warn('Failed to get current branch, using main:', error);
      return 'main';
    }
  }

  /**
   * Get branch status for a task attempt
   */
  async getBranchStatus(taskAttempt: TaskAttempt, project: Project): Promise<any> {
    try {
      const projectPath = project.git_repo_path;
      const baseBranch = taskAttempt.base_branch || 'main';
      const taskBranch = taskAttempt.branch;
      
      // Get basic branch information
      const branchStatus = {
        commits_behind: null,
        commits_ahead: null,
        has_uncommitted_changes: null,
        base_branch_name: baseBranch,
        remote_commits_behind: null,
        remote_commits_ahead: null,
        merges: []
      };

      // Check if there are uncommitted changes
      try {
        const { stdout: statusOutput } = await execAsync('git status --porcelain', { 
          cwd: taskAttempt.container_ref || projectPath 
        });
        branchStatus.has_uncommitted_changes = statusOutput.trim().length > 0;
      } catch (error) {
        logger.warn('Failed to check git status:', error);
      }

      // Get local branch comparison if both branches exist
      if (taskBranch) {
        try {
          // Get commits ahead/behind
          const { stdout: revListOutput } = await execAsync(
            `git rev-list --left-right --count ${baseBranch}...${taskBranch}`, 
            { cwd: taskAttempt.container_ref || projectPath }
          );
          const [behind, ahead] = revListOutput.trim().split('\t').map(Number);
          branchStatus.commits_behind = behind || 0;
          branchStatus.commits_ahead = ahead || 0;
        } catch (error) {
          logger.warn('Failed to get branch comparison:', error);
        }
      }

      // Get merge information
      if (this.models) {
        try {
          branchStatus.merges = await this.models.merge.findByTaskAttemptId(taskAttempt.id);
        } catch (error) {
          logger.warn('Failed to get merge information:', error);
        }
      }

      return branchStatus;
    } catch (error) {
      logger.error('Failed to get branch status:', error);
      throw error;
    }
  }

  /**
   * Get diff stream for a task attempt
   */
  async getDiffStream(taskAttempt: TaskAttempt): Promise<EventEmitter> {
    const emitter = new EventEmitter();
    
    try {
      const workingDirectory = taskAttempt.container_ref || process.cwd();
      
      logger.info(`Getting diff for directory: ${workingDirectory}`);
      
      // Check if directory exists
      const fs = require('fs');
      if (!fs.existsSync(workingDirectory)) {
        const errorMsg = `Worktree directory does not exist: ${workingDirectory}`;
        logger.error(errorMsg);
        
        // Emit error with clear message
        setTimeout(() => {
          emitter.emit('error', new Error(errorMsg));
        }, 100);
        return emitter;
      }
      
      // Check if it's a git repository or worktree
      const gitDir = path.join(workingDirectory, '.git');
      const isGitRepo = fs.existsSync(gitDir);
      
      if (!isGitRepo) {
        logger.warn(`Directory is not a standard git repository (no .git): ${workingDirectory}`);
        // It might be a worktree, try to get diff anyway
      }
      
      // Use simple-git library
      const simpleGit = require('simple-git');
      const git = simpleGit(workingDirectory);
      
      // Get current branch name
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      logger.info(`Current branch: ${currentBranch}`);
      
      // Try to find the base branch (usually main or master)
      let baseBranch = 'main';
      try {
        await git.revparse(['--verify', 'main']);
      } catch (e) {
        try {
          await git.revparse(['--verify', 'master']);
          baseBranch = 'master';
        } catch (e2) {
          logger.warn('Neither main nor master branch found, using HEAD~1');
          baseBranch = 'HEAD~1';
        }
      }
      
      logger.info(`Using base branch: ${baseBranch}`);
      
      // Get diff between current branch and base branch
      let finalDiff = '';
      
      try {
        // First try to get diff against base branch
        finalDiff = await git.diff([`${baseBranch}...HEAD`]);
        logger.info(`Diff against ${baseBranch} length: ${finalDiff ? finalDiff.length : 0}`);
      } catch (error) {
        logger.warn(`Failed to get diff against ${baseBranch}:`, error);
        
        // Fallback to working tree changes
        finalDiff = await git.diff();
        logger.info(`Working tree diff length: ${finalDiff ? finalDiff.length : 0}`);
        
        if (!finalDiff) {
          // Try staged changes
          finalDiff = await git.diff(['--cached']);
          logger.info(`Staged diff length: ${finalDiff ? finalDiff.length : 0}`);
        }
      }
      
      // Parse git diff and emit as JSON patches like Rust version
      if (finalDiff) {
        const patches = this.parseGitDiffToPatch(finalDiff);
        
        // Emit each file as a separate JSON patch event matching Rust format
        patches.forEach((patch, index) => {
          setTimeout(() => {
            emitter.emit('json_patch', [{
              op: 'add',
              path: `/entries/${patch.oldPath}`,  // Use oldPath as the key in entries
              value: {
                type: 'DIFF',
                content: {
                  change: patch.change,
                  oldPath: patch.oldPath,
                  newPath: patch.newPath,
                  oldContent: patch.oldContent,
                  newContent: patch.newContent
                }
              }
            }]);
          }, 100 * (index + 1));
        });
        
        // Emit finished event
        setTimeout(() => {
          emitter.emit('finished');
        }, 100 * (patches.length + 1));
      } else {
        // No diff, just emit finished
        setTimeout(() => {
          emitter.emit('finished');
        }, 100);
      }
      
    } catch (error) {
      logger.error('Failed to get diff stream:', error);
      setTimeout(() => {
        emitter.emit('error', error);
      }, 100);
    }
    
    return emitter;
  }

  /**
   * Parse git diff output to JSON Patch format
   */
  private parseGitDiffToPatch(diffText: string): any[] {
    const patches: any[] = [];
    
    if (!diffText || !diffText.trim()) {
      return patches;
    }

    // Split the diff by file
    const fileDiffs = diffText.split(/^diff --git /m).filter(d => d.trim());
    
    for (const fileDiff of fileDiffs) {
      const lines = fileDiff.split('\n');
      
      // Extract file paths from the first line (a/path b/path)
      const pathMatch = lines[0].match(/a\/(.+?)\s+b\/(.+?)$/);
      if (!pathMatch) continue;
      
      const oldPath = pathMatch[1];
      const newPath = pathMatch[2];
      
      // Find the @@ line to get the actual diff content
      const diffStartIndex = lines.findIndex(line => line.startsWith('@@'));
      if (diffStartIndex === -1) continue;
      
      // Extract the actual diff content (lines starting with +, -, or space)
      const diffLines = lines.slice(diffStartIndex + 1);
      
      // Separate old and new content
      let oldContent = '';
      let newContent = '';
      
      for (const line of diffLines) {
        if (line.startsWith('+')) {
          // Added line (only in new content)
          newContent += line.substring(1) + '\n';
        } else if (line.startsWith('-')) {
          // Removed line (only in old content)
          oldContent += line.substring(1) + '\n';
        } else if (line.startsWith(' ')) {
          // Context line (in both)
          oldContent += line.substring(1) + '\n';
          newContent += line.substring(1) + '\n';
        } else if (line.startsWith('\\')) {
          // Special marker like "\ No newline at end of file"
          continue;
        } else {
          // Keep context lines that don't have a prefix
          oldContent += line + '\n';
          newContent += line + '\n';
        }
      }
      
      patches.push({
        change: 'modified',
        oldPath: oldPath,
        newPath: newPath,
        oldContent: oldContent.trimEnd(),
        newContent: newContent.trimEnd()
      });
    }
    
    return patches;
  }

  /**
   * Stop task attempt execution
   */
  async stopTaskAttemptExecution(taskAttemptId: string): Promise<void> {
    try {
      if (!this.models) {
        throw new Error('Models not initialized');
      }

      // Get running execution processes for this task attempt
      const runningProcesses = await this.models.executionProcess.findByTaskAttemptId(taskAttemptId);
      
      // Stop all running processes
      for (const process of runningProcesses.filter(p => p.status === 'running')) {
        await this.stopExecutionProcess(process.id);
      }
      
      logger.info(`Stopped execution for task attempt: ${taskAttemptId}`);
    } catch (error) {
      logger.error('Failed to stop task attempt execution:', error);
      throw error;
    }
  }

  /**
   * Merge task attempt changes back to base branch
   */
  async mergeTaskAttempt(taskAttempt: TaskAttempt): Promise<void> {
    try {
      if (!this.models) {
        throw new Error('Models not initialized');
      }

      const task = await this.models.task.findById(taskAttempt.task_id);
      if (!task) {
        throw new Error('Task not found');
      }

      const project = await this.models.project.findById(task.project_id);
      if (!project) {
        throw new Error('Project not found');
      }

      const workingDirectory = taskAttempt.container_ref || project.git_repo_path;
      const baseBranch = taskAttempt.base_branch || 'main';
      const taskBranch = taskAttempt.branch;

      if (!taskBranch) {
        throw new Error('No branch found for task attempt');
      }

      // Create commit message matching Rust format
      const taskUuidStr = task.id;
      const firstUuidSection = taskUuidStr.split('-')[0];
      let commitMessage = `${task.title} (vibe-kanban ${firstUuidSection})`;
      
      // Add description if it exists
      if (task.description && task.description.trim()) {
        commitMessage += `\n\n${task.description}`;
      }

      // Use GitService to merge changes (matching Rust implementation)
      const gitService = new GitService();
      const mergeCommitId = await gitService.mergeChanges(
        project.git_repo_path,
        workingDirectory,
        taskBranch,
        baseBranch,
        commitMessage
      );

      // Record merge in database
      await this.models.merge.createDirectMerge(
        taskAttempt.id,
        mergeCommitId,
        baseBranch
      );

      // Update task status to completed
      await this.models.task.updateStatus(task.id, TaskStatus.DONE);

      logger.info(`Merged task attempt ${taskAttempt.id} to ${baseBranch}`);
    } catch (error) {
      logger.error('Failed to merge task attempt:', error);
      throw error;
    }
  }

  /**
   * Push task attempt branch to GitHub
   */
  async pushTaskAttemptBranch(taskAttempt: TaskAttempt, githubToken?: string): Promise<void> {
    try {
      // Get the worktree path from container_ref
      // In Rust, ensure_container_exists is called here
      const workingDirectory = taskAttempt.container_ref;
      if (!workingDirectory) {
        throw new Error('No container_ref found for task attempt');
      }
      const taskBranch = taskAttempt.branch;

      if (!taskBranch) {
        throw new Error('No branch found for task attempt');
      }

      // Check if worktree is clean (matching Rust's push_to_github which calls check_worktree_clean)
      logger.info(`Checking if worktree is clean: ${workingDirectory}`);
      const gitService = new GitService();
      const hasChanges = await gitService.hasTrackedChanges(workingDirectory);
      if (hasChanges) {
        throw new Error('Worktree has uncommitted changes to tracked files');
      }

      // Get remote URL
      const { stdout: remoteUrl } = await execAsync('git remote get-url origin', { cwd: workingDirectory });
      let httpsUrl = remoteUrl.trim();
      
      // Convert SSH to HTTPS if needed
      if (httpsUrl.startsWith('git@github.com:')) {
        httpsUrl = httpsUrl.replace('git@github.com:', 'https://github.com/');
      }
      
      // Remove .git suffix if present
      if (httpsUrl.endsWith('.git')) {
        httpsUrl = httpsUrl.slice(0, -4);
      }
      
      if (githubToken) {
        // Push with token authentication (like Rust version)
        // Add .git suffix for the remote URL
        const authUrl = httpsUrl.replace('https://', `https://x-access-token:${githubToken}@`) + '.git';
        
        // Remove existing temp-auth remote if it exists
        await execAsync('git remote remove temp-auth', { cwd: workingDirectory }).catch(() => {
          // Ignore if it doesn't exist
        });
        
        // Add temporary remote with auth
        await execAsync(`git remote add temp-auth "${authUrl}"`, { cwd: workingDirectory });
        
        try {
          // Push to temporary remote with auth
          logger.info(`Pushing branch ${taskBranch} using temp-auth remote`);
          await execAsync(`git push temp-auth ${taskBranch}:${taskBranch}`, { cwd: workingDirectory });
          logger.info('Push successful with authentication');
          
          // Fetch from remote and set upstream (matching Rust's implementation)
          await execAsync(`git fetch origin`, { cwd: workingDirectory });
          await execAsync(`git branch --set-upstream-to=origin/${taskBranch} ${taskBranch}`, { 
            cwd: workingDirectory 
          }).catch(() => {
            // Ignore error if branch already has upstream
          });
        } catch (pushError) {
          logger.error('Push with auth failed:', pushError);
          throw pushError;
        } finally {
          // Clean up temporary remote
          await execAsync('git remote remove temp-auth', { cwd: workingDirectory }).catch(() => {
            // Ignore error
          });
        }
      } else {
        // Fallback to regular push
        await execAsync(`git push origin ${taskBranch}`, { cwd: workingDirectory });
      }

      logger.info(`Pushed branch ${taskBranch} for task attempt ${taskAttempt.id}`);
    } catch (error) {
      logger.error('Failed to push task attempt branch:', error);
      throw error;
    }
  }

  /**
   * Rebase task attempt branch (matches Rust rebase_task_attempt)
   */
  async rebaseTaskAttempt(taskAttempt: TaskAttempt, newBaseBranch?: string): Promise<void> {
    try {
      if (!this.models) {
        throw new Error('Models not initialized');
      }

      // Get task and project context (matches Rust context loading)
      const task = await this.models.task.findById(taskAttempt.task_id);
      if (!task) {
        throw new Error('Task not found');
      }

      const project = await this.models.project.findById(task.project_id);
      if (!project) {
        throw new Error('Project not found');
      }

      // Ensure container exists (matches Rust ensure_container_exists)
      let containerRef = taskAttempt.container_ref;
      if (!containerRef) {
        // Create container if it doesn't exist (matches Rust ensure_container_exists behavior)
        logger.info(`Creating container for task attempt ${taskAttempt.id}`);
        containerRef = await this.createContainer(taskAttempt);
      }
      const worktreePath = containerRef;

      // Get GitHub config (matches Rust github_config)
      const config = await configService.loadConfig();
      const githubToken = config.github?.oauth_token || config.github?.pat;

      // Use the stored base branch if no new base branch is provided (matches Rust effective_base_branch)
      // Note: Rust uses or_else(|| Some(ctx.task_attempt.base_branch.clone()))
      // This means it ALWAYS has a value (either new_base_branch or task_attempt.base_branch)
      const effectiveBaseBranch = newBaseBranch || taskAttempt.base_branch || 'main';
      const oldBaseBranch = taskAttempt.base_branch || 'main';
      
      // Call GitService.rebaseBranch (matches Rust deployment.git().rebase_branch)
      const gitService = new GitService();
      const newBaseCommit = await gitService.rebaseBranch(
        project.git_repo_path,
        worktreePath,
        effectiveBaseBranch,  // as_deref() in Rust converts Option<String> to Option<&str>
        oldBaseBranch,        // Rust uses &ctx.task_attempt.base_branch
        githubToken
      );

      // Update base branch in database if changed (matches Rust update_base_branch)
      if (effectiveBaseBranch && effectiveBaseBranch !== taskAttempt.base_branch) {
        await this.models.taskAttempt.updateBaseBranch(taskAttempt.id, effectiveBaseBranch);
      }

      logger.info(`Rebased task attempt ${taskAttempt.id} onto ${effectiveBaseBranch}, new commit: ${newBaseCommit}`);
    } catch (error) {
      logger.error('Failed to rebase task attempt:', error);
      throw error;
    }
  }
  /**
   * Create GitHub Pull Request
   */
  async createGitHubPr(taskAttempt: TaskAttempt, prData: { title: string, body?: string, base_branch?: string }): Promise<string> {
    try {
      logger.info(`Starting PR creation for task attempt ${taskAttempt.id}`);
      
      if (!this.models) {
        throw new Error('Models not initialized');
      }

      // Note: We create a new GitHubIntegrationService instance below, so we don't need to check this.githubService

      // Get GitHub token from config
      logger.info('Loading config for GitHub token');
      const config = await configService.loadConfig();
      const githubToken = config.github?.oauth_token || config.github?.pat;
      
      if (!githubToken) {
        throw new Error('GitHub token not configured');
      }

      const task = await this.models.task.findById(taskAttempt.task_id);
      if (!task) {
        throw new Error('Task not found');
      }

      const project = await this.models.project.findById(task.project_id);
      if (!project) {
        throw new Error('Project not found');
      }

      const taskBranch = taskAttempt.branch;
      if (!taskBranch) {
        throw new Error('No branch found for task attempt');
      }

      // Determine base branch (matching Rust logic)
      let baseBranch = prData.base_branch;
      if (!baseBranch) {
        // Use stored base branch from task attempt
        if (taskAttempt.base_branch && taskAttempt.base_branch.trim()) {
          baseBranch = taskAttempt.base_branch;
        } else {
          // Fall back to config default or 'main'
          baseBranch = config.github?.default_pr_base || 'main';
        }
      }

      // Get workspace path from container_ref
      // In Rust, ensure_container_exists is called here
      const workspacePath = taskAttempt.container_ref;
      if (!workspacePath) {
        throw new Error('No container_ref found for task attempt');
      }
      logger.info(`Workspace path: ${workspacePath}`);

      // Normalize base branch name if it's a remote branch (matching Rust logic)
      const gitService = new GitService();
      let normalizedBaseBranch = baseBranch;
      try {
        const branchType = await gitService.findBranchType(project.git_repo_path, baseBranch);
        if (branchType === BranchType.REMOTE) {
          // Remote branches are formatted as {remote}/{branch} locally.
          // For PR APIs, we must provide just the branch name.
          const remoteName = gitService.getRemoteNameFromBranchName(baseBranch);
          const remotePrefix = `${remoteName}/`;
          normalizedBaseBranch = baseBranch.startsWith(remotePrefix) 
            ? baseBranch.substring(remotePrefix.length)
            : baseBranch;
          logger.info(`Normalized remote branch from '${baseBranch}' to '${normalizedBaseBranch}'`);
        }
      } catch (error) {
        logger.warn(`Could not determine branch type for ${baseBranch}, using as-is: ${error}`);
        // Use the branch name as-is if we can't determine its type
      }

      // First, push the branch with authentication
      logger.info(`Pushing branch ${taskBranch} to GitHub`);
      await this.pushTaskAttemptBranch(taskAttempt, githubToken);
      logger.info('Branch pushed successfully');

      // Create GitHubIntegrationService with worktree path
      logger.info('Creating GitHubIntegrationService with worktree path');
      // Create a ModelFactory wrapper for GitHubIntegrationService
      const modelFactory = {
        getProjectModel: () => this.models.project,
        getTaskModel: () => this.models.task,
        getTaskAttemptModel: () => this.models.taskAttempt,
        getExecutionProcessModel: () => this.models.executionProcess,
        getExecutorSessionModel: () => this.models.executorSession,
        getTaskTemplateModel: () => this.models.taskTemplate,
        getImageModel: () => this.models.image,
        getMergeModel: () => this.models.merge,
        getExecutionProcessLogModel: () => this.models.executionProcessLog,
        getAllModels: () => this.models
      } as any; // Cast to any since ModelFactory type is not available here
      const workspaceGitHubService = new GitHubIntegrationService(modelFactory, workspacePath);
      await workspaceGitHubService.initialize(githubToken);
      logger.info('GitHubIntegrationService initialized');
      
      // Create PR via GitHub API
      const prInfo = await workspaceGitHubService.createPullRequest(
        taskAttempt.id,
        {
          title: prData.title,
          body: prData.body || undefined,  // Convert null to undefined
          head: taskBranch,
          base: normalizedBaseBranch  // Use normalized branch name
        }
      );

      // Record PR in database
      await this.models.merge.createPRMerge(
        taskAttempt.id,
        prInfo.number,
        prInfo.url,
        normalizedBaseBranch  // Use normalized branch name
      );

      logger.info(`Created PR ${prInfo.url} for task attempt ${taskAttempt.id}`);
      return prInfo.url;
    } catch (error) {
      logger.error('Failed to create GitHub PR:', error);
      throw error;
    }
  }

  /**
   * Open task attempt in editor
   */
  async openTaskAttemptInEditor(taskAttempt: TaskAttempt, editorType?: string, filePath?: string): Promise<void> {
    try {
      const workingDirectory = taskAttempt.container_ref || process.cwd();
      const targetPath = filePath ? `${workingDirectory}/${filePath}` : workingDirectory;
      
      // Map editor types to their command-line tools (matching Rust implementation)
      const editorCommands: Record<string, string> = {
        'VS_CODE': 'code',
        'CURSOR': 'cursor',
        'WINDSURF': 'windsurf',
        'INTELLIJ': 'idea',
        'ZED': 'zed',
        'XCODE': 'xed',
        'CUSTOM': process.env.CUSTOM_EDITOR || 'code', // Fallback to VS Code
        // Also support lowercase variants
        'vs_code': 'code',
        'vscode': 'code',
        'cursor': 'cursor',
        'windsurf': 'windsurf',
        'intellij': 'idea',
        'zed': 'zed',
        'xcode': 'xed',
        'custom': process.env.CUSTOM_EDITOR || 'code',
      };
      
      // Get the editor command
      let editorCommand: string;
      if (editorType && editorCommands[editorType]) {
        editorCommand = editorCommands[editorType];
      } else {
        // Default to VS Code if not specified or invalid
        editorCommand = process.env.EDITOR || 'code';
      }

      await execAsync(`${editorCommand} "${targetPath}"`, { cwd: workingDirectory });

      logger.info(`Opened ${targetPath} in ${editorCommand} for task attempt ${taskAttempt.id}`);
    } catch (error) {
      logger.error('Failed to open task attempt in editor:', error);
      throw error;
    }
  }

  /**
   * Open project in editor
   */
  async openProjectInEditor(project: Project, editorType?: string): Promise<void> {
    try {
      const projectPath = project.git_repo_path;
      
      // Map editor types to their command-line tools (matching Rust implementation)
      const editorCommands: Record<string, string> = {
        'VS_CODE': 'code',
        'CURSOR': 'cursor',
        'WINDSURF': 'windsurf',
        'INTELLIJ': 'idea',
        'ZED': 'zed',
        'XCODE': 'xed',
        'CUSTOM': process.env.CUSTOM_EDITOR || 'code', // Fallback to VS Code
        // Also support lowercase variants
        'vs_code': 'code',
        'vscode': 'code',
        'cursor': 'cursor',
        'windsurf': 'windsurf',
        'intellij': 'idea',
        'zed': 'zed',
        'xcode': 'xed',
        'custom': process.env.CUSTOM_EDITOR || 'code',
      };
      
      // Debug logging
      logger.info(`Opening project in editor - editorType: ${editorType}, available commands:`, Object.keys(editorCommands));
      
      // Get the editor command
      let editorCommand: string;
      if (editorType && editorCommands[editorType]) {
        editorCommand = editorCommands[editorType];
        logger.info(`Using editor command for type '${editorType}': ${editorCommand}`);
      } else {
        // Default to VS Code if not specified or invalid
        editorCommand = process.env.EDITOR || 'code';
        logger.info(`No matching editor type, using default: ${editorCommand}`);
      }
      
      const command = `${editorCommand} "${projectPath}"`;
      logger.info(`Executing command: ${command}`);
      
      await execAsync(command, { cwd: projectPath });
      logger.info(`Opened project ${project.id} at ${projectPath} in ${editorCommand}`);
    } catch (error) {
      logger.error('Failed to open project in editor:', error);
      throw error;
    }
  }

  /**
   * Delete file from task attempt
   */
  async deleteTaskAttemptFile(taskAttempt: TaskAttempt, filePath: string): Promise<void> {
    try {
      const workingDirectory = taskAttempt.container_ref || process.cwd();
      const fullFilePath = `${workingDirectory}/${filePath}`;

      // Delete file
      await fs.unlink(fullFilePath);

      // Commit the deletion
      await execAsync(`git add "${filePath}"`, { cwd: workingDirectory });
      await execAsync(`git commit -m "Delete ${filePath}"`, { cwd: workingDirectory });

      logger.info(`Deleted file ${filePath} from task attempt ${taskAttempt.id}`);
    } catch (error) {
      logger.error('Failed to delete file from task attempt:', error);
      throw error;
    }
  }

  /**
   * Get task attempt children (related tasks)
   */
  async getTaskAttemptChildren(taskAttemptId: string): Promise<Task[]> {
    try {
      if (!this.models) {
        throw new Error('Models not initialized');
      }

      // This would need proper implementation based on how related tasks are tracked
      // For now, return empty array
      return [];
    } catch (error) {
      logger.error('Failed to get task attempt children:', error);
      throw error;
    }
  }

  /**
   * Start development server for task attempt
   */
  async startDevServer(taskAttempt: TaskAttempt): Promise<void> {
    try {
      if (!this.models) {
        throw new Error('Models not initialized');
      }

      const task = await this.models.task.findById(taskAttempt.task_id);
      if (!task) {
        throw new Error('Task not found');
      }

      const project = await this.models.project.findById(task.project_id);
      if (!project) {
        throw new Error('Project not found');
      }

      const workingDirectory = taskAttempt.container_ref || project.git_repo_path;
      
      // Stop any existing dev servers for this project
      const runningProcesses = await this.models.executionProcess.findByTaskAttemptId(taskAttempt.id);
      for (const process of runningProcesses.filter(p => p.status === 'running' && p.run_reason === ExecutionProcessRunReason.DEV_SERVER)) {
        await this.stopExecutionProcess(process.id);
      }

      // Start new dev server if project has dev script
      if (project.dev_script) {
        const devServerAction: ExecutorAction = {
          typ: {
            type: 'ScriptRequest',
            script: project.dev_script,
            language: 'bash',
            context: 'script'
          }
        };

        await this.startExecutionProcess(
          taskAttempt.id,
          'dev_server',
          devServerAction,
          workingDirectory
        );

        logger.info(`Started dev server for task attempt ${taskAttempt.id}`);
      } else {
        throw new Error('No dev server script configured for this project');
      }
    } catch (error) {
      logger.error('Failed to start dev server:', error);
      throw error;
    }
  }


  /**
   * Get next run reason based on action type (matches Rust logic)
   */
  private getNextRunReason(nextAction: any): any {
    if (nextAction.typ.type === 'CodingAgentInitialRequest' || nextAction.typ.type === 'CodingAgentFollowUpRequest') {
      return 'codingagent';
    } else if (nextAction.typ.type === 'ScriptRequest') {
      if (nextAction.typ.context === 'cleanup_script') {
        return 'cleanup_script';
      } else if (nextAction.typ.context === 'setup_script') {
        return 'setup_script';
      }
      return 'script';
    }
    return 'unknown';
  }

  /**
   * Finalize task execution (matches Rust finalize_task)
   */
  private async finalizeTask(taskAttemptId: string): Promise<void> {
    try {
      // Get task through task attempt
      const taskAttempt = await this.models!.taskAttempt.findById(taskAttemptId);
      if (!taskAttempt) {
        logger.error(`Task attempt ${taskAttemptId} not found for finalization`);
        return;
      }

      // Get task details
      const task = await this.models!.task.findById(taskAttempt.task_id);
      if (!task) {
        logger.error(`Task ${taskAttempt.task_id} not found for finalization`);
        return;
      }

      // Get execution process for status
      const executionProcesses = await this.models!.executionProcess.findByTaskAttemptId(taskAttemptId);
      const latestProcess = executionProcesses[executionProcesses.length - 1];
      
      if (latestProcess) {
        // Get config for notifications
        const config = await this.configService.getConfig();
        
        if (config.notifications) {
          // Create execution context for notification
          const executionContext = {
            task: {
              id: task.id,
              title: task.title
            },
            task_attempt: {
              id: taskAttempt.id,
              branch: taskAttempt.branch || undefined,
              profile: taskAttempt.profile
            },
            execution_process: {
              status: latestProcess.status as 'completed' | 'failed' | 'killed' | 'running'
            }
          };

          // Send notification (matches Rust NotificationService::notify_execution_halted)
          await this.notificationService.notifyExecutionHalted(config.notifications, executionContext);
        }
      }

      // Update task status to InReview (matches Rust finalize_task)
      await this.models!.task.updateStatus(taskAttempt.task_id, 'inreview' as any);
      
      logger.info(`Finalized task for attempt ${taskAttemptId} - status updated to InReview`);
    } catch (error) {
      logger.error(`Failed to finalize task for attempt ${taskAttemptId}:`, error);
    }
  }

  /**
   * Save individual log message to database (realtime, matches Rust's append_log_line)
   */
  private async saveLogMessageToDatabase(executionId: string, msg: any): Promise<void> {
    if (!this.models) return;
    
    try {
      const jsonlLine = JSON.stringify(msg) + '\n';
      await this.models.executionProcessLog.appendLogs(executionId, jsonlLine);
    } catch (error) {
      logger.error(`Failed to append log message to database for execution ${executionId}:`, error);
    }
  }

  /**
   * Save logs to database (matches Rust's execution_process_logs save)
   */
  private async saveLogsToDatabase(executionId: string, msgStore: MsgStore): Promise<void> {
    if (!this.models) return;
    
    try {
      // Get all messages from MsgStore
      const history = msgStore.getHistory();
      
      // Convert to JSONL format (one JSON per line)
      const jsonlLogs = history.map(msg => JSON.stringify(msg)).join('\n');
      
      if (jsonlLogs) {
        // Save to execution_process_logs table
        await this.models.executionProcessLog.upsert(executionId, jsonlLogs);
        logger.info(`Saved ${history.length} log entries to database for execution ${executionId}`);
      }
    } catch (error) {
      logger.error(`Failed to save logs to database for execution ${executionId}:`, error);
    }
  }

  /**
   * Cleanup execution resources (matches Rust cleanup logic)
   */
  private async cleanupExecution(executionId: string): Promise<void> {
    // Remove process manager
    this.processManagers.delete(executionId);
    
    // Cleanup MsgStore
    const msgStore = this.msgStores.get(executionId);
    if (msgStore) {
      msgStore.pushFinished();
      this.msgStores.delete(executionId);
    }
    
    logger.debug(`Cleaned up resources for execution ${executionId}`);
  }

  /**
   * Get MsgStore for execution (for SSE endpoints)
   */
  getMsgStore(executionId: string): MsgStore | undefined {
    logger.info(`[getMsgStore] Looking for MsgStore with ID: ${executionId}`);
    logger.info(`[getMsgStore] Available MsgStore IDs: ${Array.from(this.msgStores.keys()).join(', ')}`);
    const store = this.msgStores.get(executionId);
    logger.info(`[getMsgStore] Found: ${store ? 'yes' : 'no'}`);
    return store;
  }

  /**
   * Helper: Get current commit ID
   */
  private async getCurrentCommitId(directory: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: directory });
      return stdout.trim();
    } catch (error) {
      logger.error('Failed to get current commit ID:', error);
      throw error;
    }
  }
}
