import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { logger } from '../../../utils/src/logger';

const router = Router();

const CreatePRSchema = z.object({
  title: z.string(),
  body: z.string().optional(),
  head_branch: z.string(),
  base_branch: z.string().default('main')
});

// GET /api/github/user
router.get('/user', async (req: Request, res: Response) => {
  try {
    // Match Rust's behavior when GitHub feature is not enabled
    // Return HTML response ("Build frontend first")
    res.status(200);
    res.type('text/html');
    return res.send('<!DOCTYPE html>\n<html><head><title>Build frontend first</title></head>\n<body><h1>Please build the frontend</h1></body></html>');
  } catch (error) {
    logger.error('Failed to get GitHub user info:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to get GitHub user info'
    });
  }
});

// POST /api/github/task-attempts/:id/pr
router.post('/task-attempts/:id/pr', async (req: Request, res: Response) => {
  try {
    const { id: taskAttemptId } = req.params;
    const body = CreatePRSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Verify task attempt exists
    const taskAttempt = await deployment.getTaskAttempt(taskAttemptId);
    if (!taskAttempt) {
      return res.status(404).json({
        error: 'Task attempt not found',
        success: false
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

    // Create PR
    const prInfo = await deployment.createPullRequest(
      taskAttemptId,
      body.title,
      body.body || `Automated PR for task: ${task.title}\n\n${task.description || ''}`,
      body.head_branch,
      body.base_branch
    );
    
    res.status(201).json({
      data: prInfo,
      success: true
    });
  } catch (error) {
    logger.error('Failed to create pull request:', error);
    res.status(500).json({
      error: 'Failed to create pull request',
      success: false
    });
  }
});

// GET /api/github/task-attempts/:id/pr
router.get('/task-attempts/:id/pr', async (req: Request, res: Response) => {
  try {
    const { id: taskAttemptId } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    // Find PR merge record for this task attempt
    const merges = await models.getMergeModel().findByTaskAttemptId(taskAttemptId);
    const prMerges = merges.filter(m => m.merge_type === 'pr');
    
    if (prMerges.length === 0) {
      return res.status(404).json({
        error: 'No pull request found for this task attempt',
        success: false
      });
    }

    // Get the latest PR
    const latestPR = prMerges.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    res.json({
      data: {
        pr_number: latestPR.pr_number,
        pr_url: latestPR.pr_url,
        pr_status: latestPR.pr_status,
        pr_merged_at: latestPR.pr_merged_at,
        target_branch: latestPR.target_branch_name,
        created_at: latestPR.created_at
      },
      success: true
    });
  } catch (error) {
    logger.error('Failed to get pull request info:', error);
    res.status(500).json({
      error: 'Failed to get pull request info',
      success: false
    });
  }
});

// POST /api/github/refresh-prs
router.post('/refresh-prs', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const githubService = deployment.getGitHubService();
    
    if (!githubService.isInitialized()) {
      return res.status(400).json({
        error: 'GitHub integration not initialized',
        success: false
      });
    }

    await githubService.updatePRStatuses();
    
    res.json({
      data: 'PR statuses updated successfully',
      success: true
    });
  } catch (error) {
    logger.error('Failed to refresh PR statuses:', error);
    res.status(500).json({
      error: 'Failed to refresh PR statuses',
      success: false
    });
  }
});

// GET /api/github/repositories
router.get('/repositories', async (req: Request, res: Response) => {
  try {
    // Match Rust's behavior when GitHub feature is not enabled
    // Return HTML response ("Build frontend first")
    res.status(200);
    res.type('text/html');
    return res.send('<!DOCTYPE html>\n<html><head><title>Build frontend first</title></head>\n<body><h1>Please build the frontend</h1></body></html>');
  } catch (error) {
    logger.error('Failed to list GitHub repositories:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to list repositories'
    });
  }
});

// GET /api/github/status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const githubService = deployment.getGitHubService();
    
    const status = {
      initialized: githubService.isInitialized(),
      user_info: null as any
    };

    if (status.initialized) {
      try {
        status.user_info = await deployment.getGitHubUserInfo();
      } catch (error) {
        // User info fetch failed, but GitHub is still initialized
        logger.warn('Failed to fetch GitHub user info:', error);
      }
    }
    
    res.json({
      data: status,
      success: true
    });
  } catch (error) {
    logger.error('Failed to get GitHub status:', error);
    res.status(500).json({
      error: 'Failed to get GitHub status',
      success: false
    });
  }
});

export const githubRoutes = router;