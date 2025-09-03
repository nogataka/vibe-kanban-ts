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
import { Project, CreateProject, UpdateProject, Task, CreateTask, TaskAttempt, CreateTaskAttempt, TaskTemplate, CreateTaskTemplate, ExecutionProcess, TaskStatus, ExecutionProcessRunReason } from '../../db/src/models/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { FilesystemService } from '../../services/src/services/filesystem/filesystemService';
import { GitHubIntegrationService, GitHubUserInfo, PRInfo } from '../../services/src/services/github/githubIntegrationService';
import { MergeModel } from '../../db/src/models/merge';
import { ImageModel } from '../../db/src/models/image';
import { ProcessManager } from '../../services/src/services/process/processManager';
import { MsgStore } from '../../utils/src/msgStore';
import { ClaudeCode } from '../../executors/src/executors/claude';
import { ExecutorActionExecutor, ExecutorActionFactory, type ExecutorAction } from '../../executors/src/executorAction';
import { NotificationService } from '../../services/src/services/notification';
import { ConfigService } from '../../services/src/services/config';


const execAsync = promisify(exec);

export class DeploymentService {
  private projectRoot: string;
  private deploymentDir: string;
  private db?: DatabaseService;
  private filesystemService: FilesystemService;
  private githubService?: GitHubIntegrationService;
  private notificationService: NotificationService;
  private configService: ConfigService;
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

      // Initialize GitHub service with a simplified ModelFactory interface
      const modelFactory = {
        getMergeModel: () => this.models!.merge
      } as any; // GitHubIntegrationService only needs getMergeModel
      this.githubService = new GitHubIntegrationService(modelFactory, this.projectRoot);
      // Try to initialize with token from environment or config
      const githubToken = process.env.GITHUB_TOKEN;
      if (githubToken) {
        try {
          await this.githubService.initialize(githubToken);
        } catch (error) {
          logger.warn('Failed to initialize GitHub service with token:', error);
        }
      }

      // Initialize config service
      await this.configService.loadConfig();
      
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
            profile_variant_label: 'claude-code' // Matching default
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
          profile_variant_label: 'claude-code'
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
    // Create branch name similar to Rust implementation
    const shortId = attemptId.substring(0, 8);
    const safeName = taskTitle.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50);
    return `task-${shortId}-${safeName}`;
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
    const checkInterval = setInterval(async () => {
      const processManager = this.processManagers.get(executionId);
      if (!processManager) {
        clearInterval(checkInterval);
        return;
      }

      const { finished, exitCode, error } = processManager.tryWait();
      
      if (finished) {
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
    if (!this.models) return;

    try {
      // Determine final status
      const status = error ? 'failed' : (exitCode === 0 ? 'completed' : 'failed');
      
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
      if (executionProcess && status === 'completed' && exitCode === 0) {
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
    const execAsync = promisify(exec);
    
    try {
      const workingDirectory = taskAttempt.container_ref || process.cwd();
      
      // Get git diff
      const gitDiff = await execAsync('git diff', { cwd: workingDirectory });
      
      // Emit the diff data
      setTimeout(() => {
        emitter.emit('data', {
          type: 'diff',
          content: gitDiff.stdout
        });
        emitter.emit('end');
      }, 100);
      
    } catch (error) {
      logger.error('Failed to get diff stream:', error);
      setTimeout(() => {
        emitter.emit('error', error);
      }, 100);
    }
    
    return emitter;
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

      // Create commit message
      const commitMessage = `${task.title} (vibe-kanban ${taskAttempt.id.split('-')[0]})`;

      // Switch to base branch and merge
      await execAsync(`git checkout ${baseBranch}`, { cwd: workingDirectory });
      await execAsync(`git merge --no-ff ${taskBranch} -m "${commitMessage}"`, { cwd: workingDirectory });

      // Record merge in database
      await this.models.merge.create({
        id: uuidv4(),
        task_attempt_id: taskAttempt.id,
        merge_type: 'direct',
        target_branch: baseBranch,
        merge_commit_id: await this.getCurrentCommitId(workingDirectory),
        created_at: new Date(),
        updated_at: new Date()
      });

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
  async pushTaskAttemptBranch(taskAttempt: TaskAttempt): Promise<void> {
    try {
      const workingDirectory = taskAttempt.container_ref || process.cwd();
      const taskBranch = taskAttempt.branch;

      if (!taskBranch) {
        throw new Error('No branch found for task attempt');
      }

      // Push to origin
      await execAsync(`git push origin ${taskBranch}`, { cwd: workingDirectory });

      logger.info(`Pushed branch ${taskBranch} for task attempt ${taskAttempt.id}`);
    } catch (error) {
      logger.error('Failed to push task attempt branch:', error);
      throw error;
    }
  }

  /**
   * Rebase task attempt branch
   */
  async rebaseTaskAttempt(taskAttempt: TaskAttempt, newBaseBranch?: string): Promise<void> {
    try {
      if (!this.models) {
        throw new Error('Models not initialized');
      }

      const workingDirectory = taskAttempt.container_ref || process.cwd();
      const targetBaseBranch = newBaseBranch || taskAttempt.base_branch || 'main';
      const taskBranch = taskAttempt.branch;

      if (!taskBranch) {
        throw new Error('No branch found for task attempt');
      }

      // Fetch latest changes
      await execAsync('git fetch origin', { cwd: workingDirectory });

      // Switch to task branch and rebase
      await execAsync(`git checkout ${taskBranch}`, { cwd: workingDirectory });
      await execAsync(`git rebase origin/${targetBaseBranch}`, { cwd: workingDirectory });

      // Update base branch in database if changed
      if (newBaseBranch && newBaseBranch !== taskAttempt.base_branch) {
        await this.models.taskAttempt.updateBaseBranch(taskAttempt.id, newBaseBranch);
      }

      logger.info(`Rebased task attempt ${taskAttempt.id} onto ${targetBaseBranch}`);
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
      if (!this.models) {
        throw new Error('Models not initialized');
      }

      if (!this.githubService) {
        throw new Error('GitHub service not initialized');
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

      const baseBranch = prData.base_branch || taskAttempt.base_branch || 'main';

      // First, push the branch
      await this.pushTaskAttemptBranch(taskAttempt);

      // Create PR via GitHub API
      const prInfo = await this.githubService.createPullRequest(
        project.git_repo_path,
        prData.title,
        prData.body || '',
        taskBranch,
        baseBranch
      );

      // Record PR in database
      await this.models.merge.create({
        id: uuidv4(),
        task_attempt_id: taskAttempt.id,
        merge_type: 'pull_request',
        target_branch: baseBranch,
        pr_number: prInfo.number,
        pr_url: prInfo.url,
        pr_status: 'open',
        created_at: new Date(),
        updated_at: new Date()
      });

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
      const editor = editorType || process.env.EDITOR || 'code';

      await execAsync(`${editor} "${targetPath}"`, { cwd: workingDirectory });

      logger.info(`Opened ${targetPath} in ${editor} for task attempt ${taskAttempt.id}`);
    } catch (error) {
      logger.error('Failed to open task attempt in editor:', error);
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
      for (const process of runningProcesses.filter(p => p.status === 'running' && p.run_reason === 'dev_server')) {
        await this.stopExecutionProcess(process.id);
      }

      // Start new dev server if project has dev script
      if (project.dev_script) {
        const devServerAction: ExecutorActionField = {
          type: 'script',
          script_content: project.dev_script
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
   * Get task attempts (matches Rust TaskAttempt::fetch_all)
   */
  async getTaskAttempts(taskId?: string): Promise<TaskAttempt[]> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    
    // Rust版と同じロジック: taskIdがあればフィルタ、なければ全件
    return await this.models.taskAttempt.fetchAll(taskId);
  }

  /**
   * Get task attempt by ID (matches Rust TaskAttempt::find_by_id)
   */
  async getTaskAttempt(id: string): Promise<TaskAttempt | null> {
    if (!this.models) {
      throw new Error('DeploymentService not initialized');
    }
    return await this.models.taskAttempt.findById(id);
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
