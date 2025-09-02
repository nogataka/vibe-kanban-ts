import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { logger } from '../../../utils/src/logger';
import path from 'path';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

const router = Router();

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  git_repo_path: z.string().optional(),
  use_existing_repo: z.boolean().optional(),
  setup_script: z.string().optional(),
  dev_script: z.string().optional(),
  cleanup_script: z.string().optional(),
  copy_files: z.string().optional()
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  git_repo_path: z.string().optional(),
  setup_script: z.string().optional(),
  dev_script: z.string().optional(),
  cleanup_script: z.string().optional(),
  copy_files: z.string().optional()
});

const CreateProjectFromGitHubSchema = z.object({
  repository_id: z.number(),
  name: z.string().min(1),
  clone_url: z.string().url(),
  setup_script: z.string().optional(),
  dev_script: z.string().optional(),
  cleanup_script: z.string().optional()
});

// GET /api/projects
router.get('/', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const projects = await deployment.getAllProjects();
    
    res.json({
      success: true,
      data: projects,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get projects:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get projects'
    });
  }
});

// GET /api/projects/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const project = await deployment.getProject(req.params.id);

    if (!project) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project not found'
      });
    }

    res.json({
      success: true,
      data: project,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get project:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get project'
    });
  }
});

// POST /api/projects
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = CreateProjectSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;

    const projectData = {
      name: body.name,
      git_repo_path: body.git_repo_path || process.cwd(),
      use_existing_repo: body.use_existing_repo ?? true,
      setup_script: body.setup_script,
      dev_script: body.dev_script,
      cleanup_script: body.cleanup_script,
      copy_files: body.copy_files
    };

    const project = await deployment.createProject(projectData);
    
    res.status(200).json({
      success: true,
      data: project,
      error_data: null,
      message: null
    });
  } catch (error: any) {
    logger.error('Failed to create project:', error);
    
    if (error.code === 'GIT_REPO_PATH_EXISTS') {
      return res.status(409).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project with git repository path already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to create project'
    });
  }
});

// PATCH /api/projects/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = UpdateProjectSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;

    const existingProject = await deployment.getProject(req.params.id);
    if (!existingProject) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project not found'
      });
    }

    const updatedProject = await deployment.updateProject(
      req.params.id,
      body.name || existingProject.name,
      body.git_repo_path || existingProject.git_repo_path,
      body.setup_script !== undefined ? body.setup_script : existingProject.setup_script,
      body.dev_script !== undefined ? body.dev_script : existingProject.dev_script,
      body.cleanup_script !== undefined ? body.cleanup_script : existingProject.cleanup_script,
      body.copy_files !== undefined ? body.copy_files : existingProject.copy_files
    );
    
    res.json({
      success: true,
      data: updatedProject,
      error_data: null,
      message: null
    });
  } catch (error: any) {
    logger.error('Failed to update project:', error);
    
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project not found'
      });
    }
    
    if (error.code === 'GIT_REPO_PATH_EXISTS') {
      return res.status(409).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project with git repository path already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to update project'
    });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;

    const project = await deployment.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project not found'
      });
    }

    await deployment.deleteProject(req.params.id);
    
    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to delete project:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to delete project'
    });
  }
});

// GET /api/projects/:id/branches
router.get('/:id/branches', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Check if project exists
    const project = await deployment.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project not found'
      });
    }

    // Get branches from git repository
    const branches = await deployment.getProjectBranches(project.git_repo_path);
    
    res.json({
      success: true,
      data: branches,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get project branches:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get project branches'
    });
  }
});

// GET /api/projects/:id/tasks
router.get('/:id/tasks', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Check if project exists
    const project = await deployment.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project not found'
      });
    }

    const tasks = await deployment.getTasksWithAttemptStatus(req.params.id);
    
    res.json({
      success: true,
      data: tasks,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get project tasks:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get project tasks'
    });
  }
});

// POST /api/projects/from-github - Create project from GitHub repository (cloud-only feature)
router.post('/from-github', async (req: Request, res: Response) => {
  try {
    const body = CreateProjectFromGitHubSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;
    const configService = req.app.locals.configService;
    
    logger.info(`Creating project '${body.name}' from GitHub repository`);
    
    // Get GitHub configuration
    const config = await configService.loadConfig();
    const githubToken = config.github?.oauth_token;
    
    // Check if GitHub is configured
    if (!githubToken) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'GitHub token not configured. Please authenticate with GitHub first.'
      });
    }
    
    // Get workspace path (default to current directory + /workspace)
    const workspacePath = config.workspace_dir || path.join(process.cwd(), 'workspace');
    
    // Ensure workspace directory exists
    await fs.mkdir(workspacePath, { recursive: true });
    
    const targetPath = path.join(workspacePath, body.name);
    
    // Check if project directory already exists
    try {
      await fs.access(targetPath);
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'A project with this name already exists in the workspace'
      });
    } catch {
      // Directory doesn't exist, which is what we want
    }
    
    // Check if git repo path is already used by another project
    const existingProjects = await deployment.getAllProjects();
    const existingProject = existingProjects.find(p => p.git_repo_path === targetPath);
    
    if (existingProject) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'A project with this git repository path already exists'
      });
    }
    
    // Clone the repository
    try {
      logger.info(`Cloning repository ${body.clone_url} to ${targetPath}`);
      
      // Build clone command with authentication
      const cloneUrl = new URL(body.clone_url);
      cloneUrl.username = 'oauth2';
      cloneUrl.password = githubToken;
      
      const cloneCommand = `git clone "${cloneUrl.toString()}" "${targetPath}"`;
      execSync(cloneCommand, { stdio: 'pipe' });
      
      logger.info(`Successfully cloned repository to ${targetPath}`);
    } catch (error) {
      logger.error('Failed to clone repository:', error);
      return res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: `Failed to clone repository: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
    
    // Create project record in database
    const projectData = {
      name: body.name,
      git_repo_path: targetPath,
      use_existing_repo: true, // Since we just cloned it
      setup_script: body.setup_script,
      dev_script: body.dev_script,
      cleanup_script: body.cleanup_script
    };
    
    const projectId = uuidv4();
    
    try {
      const project = await deployment.createProject(projectId, projectData);
      
      // Track project creation event (if analytics enabled)
      if (config.analytics_enabled) {
        logger.info('Project created from GitHub', {
          project_id: project.id,
          repository_id: body.repository_id,
          has_setup_script: !!body.setup_script,
          has_dev_script: !!body.dev_script
        });
      }
      
      res.json({
        success: true,
        data: project,
        error_data: null,
        message: null
      });
    } catch (error) {
      logger.error('Failed to create project:', error);
      
      // Clean up cloned repository if project creation failed
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
        logger.info(`Cleaned up cloned repository at ${targetPath}`);
      } catch (cleanupError) {
        logger.error('Failed to cleanup cloned repository:', cleanupError);
      }
      
      res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Failed to create project in database'
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: error.errors,
        message: 'Invalid request data'
      });
    }
    
    logger.error('Failed to create project from GitHub:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to create project from GitHub'
    });
  }
});

export const projectRoutes = router;
