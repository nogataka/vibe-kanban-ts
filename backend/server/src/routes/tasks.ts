import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { TaskStatus } from '../../../db/src/models/types';
import { logger } from '../../../utils/src/logger';

const router = Router();

const CreateTaskSchema = z.object({
  project_id: z.string().uuid(),
  parent_task_attempt: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.enum(['todo', 'inprogress', 'done', 'cancelled', 'inreview']).optional(),
  image_ids: z.array(z.string().uuid()).nullable().optional()
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['todo', 'inprogress', 'done', 'cancelled', 'inreview']).optional(),
  parent_task_attempt: z.string().uuid().nullable().optional(),
  image_ids: z.array(z.string().uuid()).nullable().optional()
});

// GET /api/tasks
router.get('/', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const projectId = req.query.project_id as string | undefined;
    
    // Rust version requires project_id and returns plain text error
    if (!projectId) {
      res.status(400);
      res.type('text/plain');
      return res.send('Failed to deserialize query string: missing field `project_id`');
    }
    
    const tasks = await deployment.getTasksWithAttemptStatus(projectId);
    res.json({
      success: true,
      data: tasks,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get tasks:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get tasks'
    });
  }
});

// GET /api/tasks/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const task = await deployment.getTask(req.params.id);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task not found'
      });
    }

    res.json({
      success: true,
      data: task,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get task:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get task'
    });
  }
});

// POST /api/tasks
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = CreateTaskSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Check if project exists
    const project = await deployment.getProject(body.project_id);
    if (!project) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Project not found'
      });
    }

    const models = deployment.getModels();
    const taskData = {
      project_id: body.project_id,
      title: body.title,
      description: body.description,
      parent_task_attempt: body.parent_task_attempt,
      image_ids: body.image_ids
    };

    const task = await models.getTaskModel().create(taskData);

    // Update status if provided and different from default
    if (body.status && body.status !== TaskStatus.TODO) {
      await deployment.updateTaskStatus(task.id, body.status as TaskStatus);
      // Re-fetch the updated task
      const updatedTask = await deployment.getTask(task.id);
      res.status(200).json({
        success: true,
        data: updatedTask,
        error_data: null,
        message: null
      });
    } else {
      res.status(200).json({
        success: true,
        data: task,
        error_data: null,
        message: null
      });
    }
  } catch (error) {
    logger.error('Failed to create task:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to create task'
    });
  }
});

// POST /api/tasks/create-and-start - Create task and start execution
// Rust equivalent: create_task_and_start
router.post('/create-and-start', async (req: Request, res: Response) => {
  try {
    // Validate input with proper error handling
    const validationResult = CreateTaskSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: { error: 'Invalid input parameters', details: validationResult.error.issues },
        message: 'Validation failed'
      });
    }
    const body = validationResult.data;
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Check if project exists
    const project = await deployment.getProject(body.project_id);
    if (!project) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: { error: 'Project not found' },
        message: 'Project not found'
      });
    }

    // Create the task first
    const models = deployment.getModels();
    const taskData = {
      project_id: body.project_id,
      title: body.title,
      description: body.description,
      parent_task_attempt: body.parent_task_attempt,
      image_ids: body.image_ids
    };

    const task = await models.getTaskModel().create(taskData);
    
    // Associate images if provided (like Rust version)
    if (body.image_ids && body.image_ids.length > 0) {
      // TODO: Implement TaskImage.associate_many functionality
      logger.info(`Image association not implemented yet: ${body.image_ids.length} images`);
    }
    
    // Update status if provided and different from default
    if (body.status && body.status !== TaskStatus.TODO) {
      await deployment.updateTaskStatus(task.id, body.status as TaskStatus);
    }

    // Track analytics (like Rust version)
    // await deployment.trackAnalytics('task_created', {
    //   task_id: task.id,
    //   project_id: task.project_id,
    //   has_description: !!task.description,
    //   has_images: !!body.image_ids?.length,
    // });

    // Get current git branch (like Rust version)
    let currentBranch = 'main';
    try {
      const { promisify } = require('util');
      const { exec } = require('child_process');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync('git branch --show-current', { cwd: project.git_repo_path });
      currentBranch = stdout.trim() || 'main';
    } catch (error) {
      logger.warn('Failed to get current branch, using main:', error);
    }
    
    // Create task attempt with proper branch (like Rust version)
    const createAttemptData = {
      profile: 'claude-code', // Default profile like Rust version
      base_branch: currentBranch
    };
    
    const taskAttempt = await models.getTaskAttemptModel().create(createAttemptData, task.id);
    
    // Start execution process like Rust version does
    try {
      // Start the actual execution using the existing methods
      const workingDirectory = project.git_repo_path;
      
      // Start execution process with coding agent
      await deployment.startExecutionProcess(
        taskAttempt.id,
        'initial_run',
        'coding_agent_initial',
        workingDirectory
      );
      
      logger.info(`Started execution process for task attempt: ${taskAttempt.id}`);
    } catch (error) {
      logger.error('Failed to start task execution:', error);
      // Continue with response even if execution start fails - the task attempt was created
    }
    
    // Return TaskWithAttemptStatus (matching Rust structure exactly)
    const taskWithAttemptStatus = {
      id: task.id,
      project_id: task.project_id,
      title: task.title,
      description: task.description,
      status: task.status,
      parent_task_attempt: task.parent_task_attempt,
      created_at: task.created_at,
      updated_at: task.updated_at,
      has_in_progress_attempt: true,
      has_merged_attempt: false,
      last_attempt_failed: false,
      profile: taskAttempt.profile
    };
    
    logger.info(`Task created and started: ${task.id}`);
    
    res.status(200).json({
      success: true,
      data: taskWithAttemptStatus,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to create and start task:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to create and start task'
    });
  }
});

// PUT /api/tasks/:id - Change from PATCH to PUT to match frontend expectations and Rust version
router.put('/:id', async (req: Request, res: Response) => {
  try {
    logger.info(`Task update request received for ID: ${req.params.id}, Body:`, req.body);
    
    const body = UpdateTaskSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;
    
    const existingTask = await deployment.getTask(req.params.id);
    if (!existingTask) {
      logger.error(`Task not found: ${req.params.id}`);
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task not found'
      });
    }

    logger.info(`Existing task found:`, existingTask);

    // Handle image updates if provided (null means clear all images)
    if (body.image_ids !== undefined) {
      logger.info(`Updating images for task ${req.params.id}: ${body.image_ids}`);
      const models = deployment.getModels();
      // Pass empty array if image_ids is null to clear all images
      await models.getImageModel().updateTaskImages(req.params.id, body.image_ids || []);
    }

    // Use existing values if not provided in update (matching Rust implementation)
    const updateData = {
      title: body.title || existingTask.title,
      description: body.description !== undefined ? body.description : existingTask.description,
      status: body.status !== undefined ? body.status as TaskStatus : existingTask.status,
      parent_task_attempt: body.parent_task_attempt !== undefined ? body.parent_task_attempt : existingTask.parent_task_attempt
    };
    logger.info(`Update data:`, updateData);

    const updatedTask = await deployment.updateTask(req.params.id, updateData);
    
    if (!updatedTask) {
      logger.error(`Task not found after update: ${req.params.id}`);
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task not found'
      });
    }

    logger.info(`Task updated successfully:`, updatedTask);

    res.json({
      success: true,
      data: updatedTask,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to update task - detailed error:', error);
    logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to update task'
    });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;

    const task = await deployment.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task not found'
      });
    }

    await deployment.deleteTask(req.params.id);
    
    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to delete task:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to delete task'
    });
  }
});

// GET /api/tasks/:id/attempts
router.get('/:id/attempts', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;

    const task = await deployment.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task not found'
      });
    }

    const attempts = await deployment.getTaskAttempts(req.params.id);
    
    res.json({
      success: true,
      data: attempts,
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

// POST /api/tasks/:id/execute
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;

    const task = await deployment.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task not found'
      });
    }

    // Update task status to in progress
    await deployment.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

    // TODO: Create task attempt and start execution process
    // For now, just return success
    res.json({
      success: true,
      data: { message: 'Task execution started', task_id: task.id },
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to execute task:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to execute task'
    });
  }
});

export const taskRoutes = router;
