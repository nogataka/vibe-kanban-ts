import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { logger } from '../../../utils/src/logger';
import { CreateIssueOptions, CreateReviewOptions } from '../../../services/src/services/github/types';

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

// ==================== Issue Management Routes ====================

// POST /api/github/issues - Create a new issue
router.post('/issues', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Debug logging
    console.log('POST /issues body:', JSON.stringify(req.body));
    console.log('POST /issues query:', req.query);
    
    const projectId = (req.query.project_id || req.body.project_id) as string;
    
    if (!projectId) {
      return res.status(400).json({
        error: 'project_id is required',
        success: false
      });
    }
    
    // Set repository based on project
    await deployment.setGitHubRepository(projectId);
    
    const CreateIssueSchema = z.object({
      title: z.string(),
      body: z.string().optional(),
      labels: z.array(z.string()).optional(),
      assignees: z.array(z.string()).optional(),
      milestone: z.number().optional()
    });
    
    const data = CreateIssueSchema.parse(req.body);
    const issue = await deployment.createIssue(data as CreateIssueOptions);
    
    res.status(201).json({
      data: issue,
      success: true
    });
  } catch (error) {
    logger.error('Failed to create issue:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create issue',
      success: false
    });
  }
});

// GET /api/github/issues - List issues
router.get('/issues', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const projectId = req.query.project_id as string;
    
    if (!projectId) {
      return res.status(400).json({
        error: 'project_id is required',
        success: false
      });
    }
    
    // Set repository based on project
    await deployment.setGitHubRepository(projectId);
    
    const filters = {
      state: req.query.state as 'open' | 'closed' | 'all' | undefined,
      labels: req.query.labels as string | undefined,
      assignee: req.query.assignee as string | undefined,
      creator: req.query.creator as string | undefined,
      mentioned: req.query.mentioned as string | undefined,
      milestone: req.query.milestone ? Number(req.query.milestone) : undefined,
      since: req.query.since as string | undefined,
      sort: req.query.sort as 'created' | 'updated' | 'comments' | undefined,
      direction: req.query.direction as 'asc' | 'desc' | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      per_page: req.query.per_page ? Number(req.query.per_page) : undefined
    };
    
    const issues = await deployment.getIssues(filters);
    
    res.json({
      data: issues,
      success: true
    });
  } catch (error) {
    logger.error('Failed to list issues:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to list issues',
      success: false
    });
  }
});

// GET /api/github/issues/:issue_number - Get a specific issue
router.get('/issues/:issue_number', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const issueNumber = Number(req.params.issue_number);
    
    if (isNaN(issueNumber)) {
      return res.status(400).json({
        error: 'Invalid issue number',
        success: false
      });
    }
    
    const issue = await deployment.getIssue(issueNumber);
    
    if (!issue) {
      return res.status(404).json({
        error: 'Issue not found',
        success: false
      });
    }
    
    res.json({
      data: issue,
      success: true
    });
  } catch (error) {
    logger.error('Failed to get issue:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get issue',
      success: false
    });
  }
});

// PATCH /api/github/issues/:issue_number - Update an issue
router.patch('/issues/:issue_number', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const issueNumber = Number(req.params.issue_number);
    
    if (isNaN(issueNumber)) {
      return res.status(400).json({
        error: 'Invalid issue number',
        success: false
      });
    }
    
    const UpdateIssueSchema = z.object({
      title: z.string().optional(),
      body: z.string().optional(),
      state: z.enum(['open', 'closed']).optional(),
      labels: z.array(z.string()).optional(),
      assignees: z.array(z.string()).optional(),
      milestone: z.number().nullable().optional()
    });
    
    const data = UpdateIssueSchema.parse(req.body);
    const issue = await deployment.updateIssue(issueNumber, data);
    
    res.json({
      data: issue,
      success: true
    });
  } catch (error) {
    logger.error('Failed to update issue:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update issue',
      success: false
    });
  }
});

// POST /api/github/issues/:issue_number/comments - Add a comment to an issue
router.post('/issues/:issue_number/comments', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const issueNumber = Number(req.params.issue_number);
    
    if (isNaN(issueNumber)) {
      return res.status(400).json({
        error: 'Invalid issue number',
        success: false
      });
    }
    
    const CommentSchema = z.object({
      body: z.string()
    });
    
    const { body } = CommentSchema.parse(req.body);
    const comment = await deployment.addIssueComment(issueNumber, body);
    
    res.status(201).json({
      data: comment,
      success: true
    });
  } catch (error) {
    logger.error('Failed to add comment:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to add comment',
      success: false
    });
  }
});

// GET /api/github/issues/:issue_number/comments - Get comments for an issue
router.get('/issues/:issue_number/comments', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const issueNumber = Number(req.params.issue_number);
    
    if (isNaN(issueNumber)) {
      return res.status(400).json({
        error: 'Invalid issue number',
        success: false
      });
    }
    
    const comments = await deployment.getIssueComments(issueNumber);
    
    res.json({
      data: comments,
      success: true
    });
  } catch (error) {
    logger.error('Failed to get comments:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get comments',
      success: false
    });
  }
});

// ==================== PR Review Routes ====================

// POST /api/github/pulls/:pull_number/reviews - Create a PR review
router.post('/pulls/:pull_number/reviews', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    
    if (isNaN(pullNumber)) {
      return res.status(400).json({
        error: 'Invalid pull request number',
        success: false
      });
    }
    
    const CreateReviewSchema = z.object({
      body: z.string().optional(),
      event: z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']).optional(),
      comments: z.array(z.object({
        path: z.string().optional(),
        position: z.number().optional(),
        line: z.number().optional(),
        side: z.enum(['LEFT', 'RIGHT']).optional(),
        start_line: z.number().optional(),
        start_side: z.enum(['LEFT', 'RIGHT']).optional(),
        body: z.string()
      })).optional()
    });
    
    const data = CreateReviewSchema.parse(req.body);
    const review = await deployment.createPRReview(pullNumber, data as CreateReviewOptions);
    
    res.status(201).json({
      data: review,
      success: true
    });
  } catch (error) {
    logger.error('Failed to create PR review:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create PR review',
      success: false
    });
  }
});

// GET /api/github/pulls/:pull_number/reviews - List PR reviews
router.get('/pulls/:pull_number/reviews', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    
    if (isNaN(pullNumber)) {
      return res.status(400).json({
        error: 'Invalid pull request number',
        success: false
      });
    }
    
    const reviews = await deployment.getPRReviews(pullNumber);
    
    res.json({
      data: reviews,
      success: true
    });
  } catch (error) {
    logger.error('Failed to get PR reviews:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get PR reviews',
      success: false
    });
  }
});

// PUT /api/github/pulls/:pull_number/reviews/:review_id/events - Submit a review
router.put('/pulls/:pull_number/reviews/:review_id/events', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    const reviewId = Number(req.params.review_id);
    
    if (isNaN(pullNumber) || isNaN(reviewId)) {
      return res.status(400).json({
        error: 'Invalid pull request or review ID',
        success: false
      });
    }
    
    const SubmitReviewSchema = z.object({
      event: z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'])
    });
    
    const { event } = SubmitReviewSchema.parse(req.body);
    const review = await deployment.submitPRReview(pullNumber, reviewId, event);
    
    res.json({
      data: review,
      success: true
    });
  } catch (error) {
    logger.error('Failed to submit PR review:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to submit PR review',
      success: false
    });
  }
});

// POST /api/github/pulls/:pull_number/reviews/:review_id/comments - Add review comment
router.post('/pulls/:pull_number/reviews/:review_id/comments', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    const reviewId = Number(req.params.review_id);
    
    if (isNaN(pullNumber) || isNaN(reviewId)) {
      return res.status(400).json({
        error: 'Invalid pull request or review ID',
        success: false
      });
    }
    
    const CommentSchema = z.object({
      body: z.string()
    });
    
    const { body } = CommentSchema.parse(req.body);
    const comment = await deployment.addReviewComment(pullNumber, reviewId, body);
    
    res.status(201).json({
      data: comment,
      success: true
    });
  } catch (error) {
    logger.error('Failed to add review comment:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to add review comment',
      success: false
    });
  }
});

// GET /api/github/pulls/:pull_number/comments - Get PR review comments
router.get('/pulls/:pull_number/comments', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    
    if (isNaN(pullNumber)) {
      return res.status(400).json({
        error: 'Invalid pull request number',
        success: false
      });
    }
    
    const comments = await deployment.getPRComments(pullNumber);
    
    res.json({
      data: comments,
      success: true
    });
  } catch (error) {
    logger.error('Failed to get PR comments:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get PR comments',
      success: false
    });
  }
});

// POST /api/github/pulls/:pull_number/comments/:comment_id/replies - Reply to a comment
router.post('/pulls/:pull_number/comments/:comment_id/replies', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    const commentId = Number(req.params.comment_id);
    
    if (isNaN(pullNumber) || isNaN(commentId)) {
      return res.status(400).json({
        error: 'Invalid pull request or comment ID',
        success: false
      });
    }
    
    const ReplySchema = z.object({
      body: z.string()
    });
    
    const { body } = ReplySchema.parse(req.body);
    const reply = await deployment.replyToComment(pullNumber, commentId, body);
    
    res.status(201).json({
      data: reply,
      success: true
    });
  } catch (error) {
    logger.error('Failed to reply to comment:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to reply to comment',
      success: false
    });
  }
});

// ==================== Pull Requests List ====================

// GET /api/github/pulls - Get list of pull requests
router.get('/pulls', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const projectId = req.query.project_id as string;
    
    if (!projectId) {
      return res.status(400).json({
        error: 'project_id is required',
        success: false
      });
    }
    
    // Set repository based on project
    await deployment.setGitHubRepository(projectId);
    
    // Parse query parameters for filtering
    const filters = {
      state: req.query.state as 'open' | 'closed' | 'all' | undefined,
      head: req.query.head as string | undefined,
      base: req.query.base as string | undefined,
      sort: req.query.sort as 'created' | 'updated' | 'popularity' | 'long-running' | undefined,
      direction: req.query.direction as 'asc' | 'desc' | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      per_page: req.query.per_page ? Number(req.query.per_page) : undefined
    };
    
    const pullRequests = await deployment.getPullRequests(filters);
    
    res.status(200).json({
      data: pullRequests,
      success: true
    });
  } catch (error) {
    logger.error('Failed to get pull requests:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get pull requests',
      success: false
    });
  }
});

// ==================== Merge Routes ====================

// POST /api/github/pulls/:pull_number/merge - Merge a pull request
router.post('/pulls/:pull_number/merge', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    
    if (isNaN(pullNumber)) {
      return res.status(400).json({
        error: 'Invalid pull request number',
        success: false
      });
    }
    
    const MergeSchema = z.object({
      commit_title: z.string().optional(),
      commit_message: z.string().optional(),
      merge_method: z.enum(['merge', 'squash', 'rebase']).optional(),
      sha: z.string().optional()
    });
    
    const options = MergeSchema.parse(req.body);
    const result = await deployment.mergePullRequest(pullNumber, options);
    
    res.json({
      data: result,
      success: true
    });
  } catch (error) {
    logger.error('Failed to merge pull request:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to merge pull request',
      success: false
    });
  }
});

// GET /api/github/pulls/:pull_number/merge - Check if PR is mergeable
router.get('/pulls/:pull_number/merge', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    
    if (isNaN(pullNumber)) {
      return res.status(400).json({
        error: 'Invalid pull request number',
        success: false
      });
    }
    
    const status = await deployment.checkMergeability(pullNumber);
    
    res.json({
      data: status,
      success: true
    });
  } catch (error) {
    logger.error('Failed to check mergeability:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to check mergeability',
      success: false
    });
  }
});

// PUT /api/github/pulls/:pull_number/update-branch - Update PR branch with base branch
router.put('/pulls/:pull_number/update-branch', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    
    if (isNaN(pullNumber)) {
      return res.status(400).json({
        error: 'Invalid pull request number',
        success: false
      });
    }
    
    await deployment.updatePullRequestBranch(pullNumber);
    
    res.json({
      message: `Pull request #${pullNumber} branch updated successfully`,
      success: true
    });
  } catch (error) {
    logger.error('Failed to update pull request branch:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update pull request branch',
      success: false
    });
  }
});

// DELETE /api/github/pulls/:pull_number - Close a pull request
router.delete('/pulls/:pull_number', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const pullNumber = Number(req.params.pull_number);
    
    if (isNaN(pullNumber)) {
      return res.status(400).json({
        error: 'Invalid pull request number',
        success: false
      });
    }
    
    await deployment.closePullRequest(pullNumber);
    
    res.json({
      message: `Pull request #${pullNumber} closed successfully`,
      success: true
    });
  } catch (error) {
    logger.error('Failed to close pull request:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to close pull request',
      success: false
    });
  }
});

export const githubRoutes = router;