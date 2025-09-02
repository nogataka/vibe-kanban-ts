import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { ExecutionProcessRunReason } from '../../../db/src/models/types';
import { logger } from '../../../utils/src/logger';

const router = Router();

const CreateTaskAttemptSchema = z.object({
  task_id: z.string(),
  profile: z.string(),
  base_branch: z.string().default('main')
});

const CreateFollowUpAttemptSchema = z.object({
  prompt: z.string(),
  variant: z.string().nullable().optional(),
  image_ids: z.array(z.string().uuid()).nullable().optional()
});

const RebaseTaskAttemptSchema = z.object({
  new_base_branch: z.string().optional()
});

const CreateGitHubPrSchema = z.object({
  title: z.string(),
  body: z.string().optional(),
  base_branch: z.string().optional()
});

const OpenEditorSchema = z.object({
  editor_type: z.string().optional(),
  file_path: z.string().optional()
});

const DeleteFileSchema = z.object({
  file_path: z.string()
});

// GET /api/task-attempts?task_id=...
router.get('/', async (req: Request, res: Response) => {
  try {
    const taskId = req.query.task_id as string | undefined;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempts = await deployment.getTaskAttempts(taskId);

    res.json({
      success: true,
      data: taskAttempts,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get task attempts:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get task attempts'
    });
  }
});

// GET /api/task-attempts/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);

    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    res.json({
      success: true,
      data: taskAttempt,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get task attempt:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get task attempt'
    });
  }
});

// POST /api/task-attempts
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = CreateTaskAttemptSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Validate that task exists
    const task = await deployment.getTask(body.task_id);
    if (!task) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task not found'
      });
    }

    const taskAttempt = await deployment.createTaskAttempt(
      body.task_id,
      body.profile,
      body.base_branch
    );

    res.status(200).json({
      success: true,
      data: taskAttempt,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to create task attempt:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to create task attempt'
    });
  }
});

// POST /api/task-attempts/:id/execute
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    const task = await deployment.getTask(taskAttempt.task_id);
    if (!task) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task not found'
      });
    }

    const project = await deployment.getProject(task.project_id);
    if (!project) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project not found'
      });
    }

    // Create working directory (container_ref or worktree)
    const workingDirectory = taskAttempt.container_ref || project.git_repo_path;

    // Start setup script if available
    if (project.setup_script) {
      const setupAction = {
        typ: {
          type: 'ScriptRequest',
          script: project.setup_script,
          language: 'bash',
          context: 'setup'
        }
      };

      await deployment.startExecutionProcess(
        taskAttempt.id,
        ExecutionProcessRunReason.SETUP_SCRIPT,
        setupAction,
        workingDirectory
      );
    }

    // Start coding agent execution
    // Use the correct ExecutorAction format that matches executorAction.ts
    const codingAction = {
      typ: {
        type: 'CodingAgentInitialRequest',
        prompt: models.getTaskModel().toPrompt(task),
        profile_variant_label: taskAttempt.profile || 'claude-code'
      }
    };

    const executionProcess = await deployment.startExecutionProcess(
      taskAttempt.id,
      ExecutionProcessRunReason.CODING_AGENT,
      codingAction,
      workingDirectory
    );

    res.json({
      success: true,
      data: {
        task_attempt: taskAttempt,
        execution_process: executionProcess
      },
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to execute task attempt:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to execute task attempt'
    });
  }
});

// POST /api/task-attempts/:id/follow-up
router.post('/:id/follow-up', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = CreateFollowUpAttemptSchema.parse(req.body);
    
    // Debug log to verify the received prompt
    logger.info(`[follow-up] Received follow-up request for task attempt ${id} with prompt: "${body.prompt}"`);
    
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    // Get the latest session ID for follow-up
    const sessionId = await models.getExecutionProcessModel().findLatestSessionIdByTaskAttempt(id);
    
    const workingDirectory = taskAttempt.container_ref || process.cwd();

    // Use variant from request if provided (and not null), otherwise use task attempt's profile
    const profileVariant = (body.variant && body.variant !== null) ? body.variant : (taskAttempt.profile || 'claude-code');

    // Start coding agent follow-up execution
    // Use the correct ExecutorAction format that matches executorAction.ts
    const followUpAction = {
      typ: {
        type: 'CodingAgentFollowUpRequest',
        prompt: body.prompt,
        profile_variant_label: profileVariant,
        session_id: sessionId,
        image_ids: body.image_ids || undefined // Pass image IDs only if provided and not null
      }
    };

    logger.info(`[follow-up] Creating execution with prompt: "${followUpAction.typ.prompt}", profile: ${profileVariant}, session_id: ${sessionId}`);

    const executionProcess = await deployment.startExecutionProcess(
      taskAttempt.id,
      ExecutionProcessRunReason.CODING_AGENT,
      followUpAction,
      workingDirectory
    );

    res.json({
      success: true,
      data: {
        task_attempt: taskAttempt,
        execution_process: executionProcess
      },
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to create follow-up execution:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to create follow-up execution'
    });
  }
});

// GET /api/task-attempts/:id/execution-processes
router.get('/:id/execution-processes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    const executionProcesses = await models.getExecutionProcessModel().findByTaskAttemptId(id);

    res.json({
      success: true,
      data: executionProcesses,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get execution processes for task attempt:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get execution processes'
    });
  }
});

// DELETE /api/task-attempts/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    // Stop any running execution processes
    const runningProcesses = await models.getExecutionProcessModel().findByTaskAttemptId(id);
    for (const process of runningProcesses.filter(p => p.status === 'running')) {
      await deployment.stopExecutionProcess(process.id);
    }

    // Clean up execution processes and sessions
    await models.getExecutionProcessModel().deleteByTaskAttemptId(id);
    await models.getExecutorSessionModel().deleteByTaskAttemptId(id);

    // Mark worktree as deleted
    if (taskAttempt.container_ref && !taskAttempt.worktree_deleted) {
      await models.getTaskAttemptModel().markWorktreeDeleted(id);
    }

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to delete task attempt:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to delete task attempt'
    });
  }
});

// BranchStatus interface to match Rust implementation
interface BranchStatus {
  commits_behind: number | null;
  commits_ahead: number | null;
  has_uncommitted_changes: boolean | null;
  base_branch_name: string;
  remote_commits_behind: number | null;
  remote_commits_ahead: number | null;
  merges: any[]; // This would need proper type from Merge model
}

// GET /api/task-attempts/:id/branch-status
router.get('/:id/branch-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    // Get task and project for context
    const task = await deployment.getTask(taskAttempt.task_id);
    if (!task) {
      return res.status(404).json({
        error: 'Task not found',
        success: false
      });
    }

    const project = await deployment.getProject(task.project_id);
    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        success: false
      });
    }

    // Get branch status information
    const branchStatus: BranchStatus = await deployment.getBranchStatus(taskAttempt, project);

    res.json({
      success: true,
      data: branchStatus,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get branch status:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get branch status'
    });
  }
});

// GET /api/task-attempts/:id/diff - Server-Sent Events endpoint
router.get('/:id/diff', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Get diff stream
    const diffStream = await deployment.getDiffStream(taskAttempt);
    
    // Stream diff data to client
    diffStream.on('data', (chunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    });

    diffStream.on('end', () => {
      res.write('event: close\ndata: \n\n');
      res.end();
    });

    diffStream.on('error', (error) => {
      logger.error('Diff stream error:', error);
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
      diffStream.removeAllListeners();
    });

  } catch (error) {
    logger.error('Failed to get diff:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get diff'
    });
  }
});

// POST /api/task-attempts/:id/stop
router.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    await deployment.stopTaskAttemptExecution(id);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to stop task attempt execution:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to stop task attempt execution'
    });
  }
});

// POST /api/task-attempts/:id/merge
router.post('/:id/merge', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    await deployment.mergeTaskAttempt(taskAttempt);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to merge task attempt:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to merge task attempt'
    });
  }
});

// POST /api/task-attempts/:id/push
router.post('/:id/push', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    await deployment.pushTaskAttemptBranch(taskAttempt);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to push task attempt branch:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to push task attempt branch'
    });
  }
});

// POST /api/task-attempts/:id/rebase
router.post('/:id/rebase', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = RebaseTaskAttemptSchema.parse(req.body || {});
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    await deployment.rebaseTaskAttempt(taskAttempt, body.new_base_branch);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to rebase task attempt:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to rebase task attempt'
    });
  }
});

// POST /api/task-attempts/:id/pr
router.post('/:id/pr', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = CreateGitHubPrSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    const prUrl = await deployment.createGitHubPr(taskAttempt, body);

    res.json({
      success: true,
      data: prUrl,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to create GitHub PR:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to create GitHub PR'
    });
  }
});

// POST /api/task-attempts/:id/open-editor
router.post('/:id/open-editor', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = OpenEditorSchema.parse(req.body || {});
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    await deployment.openTaskAttemptInEditor(taskAttempt, body.editor_type, body.file_path);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to open task attempt in editor:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to open task attempt in editor'
    });
  }
});

// POST /api/task-attempts/:id/delete-file
router.post('/:id/delete-file', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { file_path } = req.query;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    if (!file_path || typeof file_path !== 'string') {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'file_path query parameter is required'
      });
    }

    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    await deployment.deleteTaskAttemptFile(taskAttempt, file_path);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to delete file from task attempt:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to delete file from task attempt'
    });
  }
});

// GET /api/task-attempts/:id/children
router.get('/:id/children', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    const children = await deployment.getTaskAttemptChildren(id);

    res.json({
      success: true,
      data: children,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get task attempt children:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get task attempt children'
    });
  }
});

// POST /api/task-attempts/:id/start-dev-server
router.post('/:id/start-dev-server', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const taskAttempt = await deployment.getTaskAttempt(id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    await deployment.startDevServer(taskAttempt);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to start dev server:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to start dev server'
    });
  }
});

export const taskAttemptRoutes = router;
