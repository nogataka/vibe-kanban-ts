import { Router, Request, Response } from 'express';
import { ClaudeLogReader } from '../../../services/src/services/claudeLogReader';
import { logger } from '../../../utils/src/logger';
import * as path from 'path';

const router = Router();
const claudeLogReader = new ClaudeLogReader();

/**
 * Get raw Claude session logs for a task attempt
 */
router.get('/task-attempts/:attemptId/raw-logs', async (req: Request, res: Response) => {
  try {
    const { attemptId } = req.params;
    const { sessionId } = req.query;
    
    // Get deployment service from app locals
    const deployment = req.app.locals.deployment;
    if (!deployment) {
      return res.status(500).json({
        success: false,
        data: null,
        error: 'Deployment service not initialized'
      });
    }

    // Get task attempt details to find the worktree directory
    const taskAttempt = await deployment.getTaskAttempt(attemptId);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Task attempt not found'
      });
    }

    // Get task to get the title
    const task = await deployment.getTask(taskAttempt.task_id);
    if (!task) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Task not found'
      });
    }

    // Get the worktree directory for this task attempt
    const worktreeBaseDir = deployment.getWorktreeBaseDir();
    const attemptDirName = deployment.dirNameFromTaskAttempt(attemptId, task.title);
    const attemptDir = path.join(worktreeBaseDir, attemptDirName);
    
    logger.info(`Fetching raw logs for attempt ${attemptId} from directory: ${attemptDir}`);

    // Read Claude session logs
    const sessionData = await claudeLogReader.readSessionLogs(
      attemptDir, 
      sessionId as string | undefined
    );

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'No Claude session logs found for this task attempt'
      });
    }

    res.json({
      success: true,
      data: sessionData,
      error: null
    });
  } catch (error) {
    logger.error('Error fetching raw logs:', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error instanceof Error ? error.message : 'Failed to fetch raw logs'
    });
  }
});

/**
 * List available Claude sessions for a task attempt
 */
router.get('/task-attempts/:attemptId/sessions', async (req: Request, res: Response) => {
  try {
    const { attemptId } = req.params;
    
    // Get deployment service from app locals
    const deployment = req.app.locals.deployment;
    if (!deployment) {
      return res.status(500).json({
        success: false,
        data: null,
        error: 'Deployment service not initialized'
      });
    }

    // Get task attempt details
    const taskAttempt = await deployment.getTaskAttempt(attemptId);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Task attempt not found'
      });
    }

    // Get task to get the title
    const task = await deployment.getTask(taskAttempt.task_id);
    if (!task) {
      return res.status(404).json({
        success: false,
        data: null,
        error: 'Task not found'
      });
    }

    // Get the worktree directory for this task attempt
    const worktreeBaseDir = deployment.getWorktreeBaseDir();
    const attemptDirName = deployment.dirNameFromTaskAttempt(attemptId, task.title);
    const attemptDir = path.join(worktreeBaseDir, attemptDirName);
    
    // List available sessions
    const sessions = await claudeLogReader.listSessions(attemptDir);

    res.json({
      success: true,
      data: {
        sessions,
        attemptId,
        attemptDir
      },
      error: null
    });
  } catch (error) {
    logger.error('Error listing sessions:', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error instanceof Error ? error.message : 'Failed to list sessions'
    });
  }
});

export const rawLogsRoutes = router;