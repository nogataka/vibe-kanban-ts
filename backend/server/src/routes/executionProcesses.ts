import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { ExecutionProcessRunReason, ExecutorActionField } from '../../../db/src/models/types';
import { logger } from '../../../utils/src/logger';

const router = Router();

const ExecutionProcessQuerySchema = z.object({
  task_attempt_id: z.string().uuid()
});

const CreateExecutionProcessSchema = z.object({
  task_attempt_id: z.string().uuid(),
  run_reason: z.enum(['setupscript', 'cleanupscript', 'codingagent', 'devserver']),
  executor_action: z.record(z.any()), // JSON object
  working_directory: z.string().optional()
});

// GET /api/execution-processes?task_attempt_id=...
router.get('/', async (req: Request, res: Response) => {
  try {
    // Check if task_attempt_id is provided (required parameter)
    // Rust version returns plain text error
    if (!req.query.task_attempt_id) {
      res.status(400);
      res.type('text/plain');
      return res.send('Failed to deserialize query string: missing field `task_attempt_id`');
    }
    
    const query = ExecutionProcessQuerySchema.parse(req.query);
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    const executionProcesses = await models.getExecutionProcessModel().findByTaskAttemptId(query.task_attempt_id);

    res.json({
      success: true,
      data: executionProcesses,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get execution processes:', error);
    // Return 400 for validation errors, 500 for other errors
    const isValidationError = error instanceof ZodError;
    res.status(isValidationError ? 400 : 500).json({
      success: false,
      data: null,
      error_data: null,
      message: isValidationError ? 'Invalid parameters' : 'Failed to get execution processes'
    });
  }
});

// GET /api/execution-processes/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    const executionProcess = await models.getExecutionProcessModel().findById(id);

    if (!executionProcess) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Execution process not found'
      });
    }

    res.json({
      success: true,
      data: executionProcess,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get execution process:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get execution process'
    });
  }
});

// POST /api/execution-processes
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = CreateExecutionProcessSchema.parse(req.body);
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Validate that task attempt exists
    const taskAttempt = await deployment.getTaskAttempt(body.task_attempt_id);
    if (!taskAttempt) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Task attempt not found'
      });
    }

    const workingDirectory = body.working_directory || taskAttempt.container_ref || process.cwd();
    
    const executionProcess = await deployment.startExecutionProcess(
      body.task_attempt_id,
      body.run_reason as ExecutionProcessRunReason,
      body.executor_action as ExecutorActionField,
      workingDirectory
    );

    res.status(200).json({
      success: true,
      data: executionProcess,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to create execution process:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to create execution process'
    });
  }
});

// GET /api/execution-processes/:id/raw-logs (SSE)
router.get('/:id/raw-logs', async (req: Request, res: Response) => {
  const { id } = req.params;
  
  // Set headers for Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Get MsgStore for this execution (matches Rust msg_stores lookup)
    const msgStore = deployment.getMsgStore(id);
    
    if (!msgStore) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Execution process not found or not running' })}\n\n`);
      res.end();
      return;
    }

    // Send initial connection confirmation
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to raw logs' })}\n\n`);

    // Stream existing messages first, then live stream (matches Rust history_plus_stream)
    try {
      for await (const logMsg of msgStore.historyPlusStream()) {
        if (logMsg.type === 'stdout' || logMsg.type === 'stderr') {
          // Format as json_patch event to match frontend expectations
          const patch = [{
            value: {
              type: logMsg.type.toUpperCase(),
              content: logMsg.content
            }
          }];
          res.write(`event: json_patch\ndata: ${JSON.stringify(patch)}\n\n`);
        } else if (logMsg.type === 'finished') {
          res.write(`event: finished\ndata: ${JSON.stringify({ message: 'Log stream ended' })}\n\n`);
          break;
        }
      }
    } catch (streamError) {
      logger.error(`Error streaming logs for execution ${id}:`, streamError);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
    }
    
    res.end();

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }, 30000);

    const cleanup = () => {
      clearInterval(keepAlive);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);

  } catch (error) {
    logger.error('Failed to stream raw logs:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to stream logs' })}\n\n`);
    res.end();
  }
});

// GET /api/execution-processes/:id/normalized-logs (SSE)
router.get('/:id/normalized-logs', async (req: Request, res: Response) => {
  const { id } = req.params;
  
  // Helper function to convert UUID string to Buffer for DB query
  const uuidToBuffer = (uuid: string): Buffer => {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
  };
  
  // Set headers for Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // First try to get MsgStore from deployment service
    const msgStore = deployment.getMsgStore(id);
    
    if (msgStore) {
      // Process live logs directly from deployment's MsgStore
      logger.info(`[normalized-logs] Using live MsgStore for execution ${id}`);
      
      // Get execution process details for context
      const db = req.app.locals.db;
      const process = await db.getKnex()('execution_processes')
        .where('id', uuidToBuffer(id))
        .first();
      
      if (!process) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Execution process not found' })}\n\n`);
        res.end();
        return;
      }
      
      // Get task attempt for working directory (task_attempt_id is already a buffer)
      const taskAttempt = await db.getKnex()('task_attempts')
        .where('id', process.task_attempt_id)
        .first();
      
      if (!taskAttempt) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Task attempt not found' })}\n\n`);
        res.end();
        return;
      }
      
      // Parse executor action
      let executorAction: any;
      try {
        executorAction = JSON.parse(process.executor_action || '{}');
        logger.info(`[normalized-logs] Parsed executor action:`, JSON.stringify(executorAction).substring(0, 500));
      } catch (err) {
        logger.error(`Failed to parse executor action:`, err);
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Invalid executor action' })}\n\n`);
        res.end();
        return;
      }
      
      // For live MsgStore, normalizeLogs is already called by DeploymentService
      // We only need to send the initial user message if it hasn't been sent yet
      logger.info(`[normalized-logs] Checking if initial user message needs to be sent`);
      
      // Check both typ.type and type fields for compatibility
      const executorType = executorAction.typ?.type || executorAction.type;
      
      if (executorType === 'CodingAgentInitialRequest' || 
          executorType === 'CodingAgentFollowUpRequest' ||
          process.run_reason === 'codingagent') {  // Also check run_reason as a fallback
        
        // Check if user message was already sent by looking at the history
        const history = msgStore.getHistory();
        const hasUserMessage = history.some(msg => 
          msg.type === 'json_patch' && 
          msg.patches?.some((p: any) => 
            p.value?.content?.entry_type?.type === 'user_message'
          )
        );
        
        if (!hasUserMessage && (executorAction.typ?.prompt || executorAction.prompt)) {
          logger.info(`[normalized-logs] Sending initial user message`);
          const { ConversationPatch } = require('../../../executors/src/logs/conversationPatch');
          const userPrompt = executorAction.typ?.prompt || executorAction.prompt;
          const initialUserEntry = {
            timestamp: null,
            entry_type: { type: 'user_message' },
            content: userPrompt,
            metadata: null
          };
          
          const initialPatch = ConversationPatch.addNormalizedEntry(0, initialUserEntry);
          msgStore.pushPatch(initialPatch);
        } else {
          logger.info(`[normalized-logs] Initial user message already sent or not needed`);
        }
      }
      
      // Stream normalized logs
      const stream = msgStore.createNormalizedSSEStream();
      
      // Send initial connection confirmation
      res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to normalized logs' })}\n\n`);

      // Pipe the stream to the response
      stream.on('data', (chunk: any) => {
        // The stream already provides SSE-formatted data
        logger.debug(`[normalized-logs] Stream data received: ${chunk.toString().substring(0, 200)}`);
        res.write(chunk);
      });

      stream.on('end', () => {
        res.end();
      });

      stream.on('error', (error: Error) => {
        logger.error(`Error streaming normalized logs for execution ${id}:`, error);
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
        res.end();
      });

      // Keep connection alive
      const keepAlive = setInterval(() => {
        if (!res.closed) {
          res.write(`: keepalive ${Date.now()}\n\n`);
        }
      }, 30000);

      const cleanup = () => {
        clearInterval(keepAlive);
        if (stream && typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
      };

      req.on('close', cleanup);
      req.on('error', cleanup);
    } else {
      // Fallback to DB-based approach via container service
      logger.info(`[normalized-logs] No live MsgStore, trying container service fallback for execution ${id}`);
      
      const db = req.app.locals.db;
      
      // Note: Initial user message will be included in the normalized logs from DB,
      // so we don't need to send it separately here
      
      const containerService = db.getContainerService();
      
      if (!containerService) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Container service not available' })}\n\n`);
        res.end();
        return;
      }
      
      // Get normalized log stream from container service
      const stream = await containerService.streamNormalizedLogs(id);
      
      if (!stream) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Execution process not found or logs not available' })}\n\n`);
        res.end();
        return;
      }

      // Send initial connection confirmation
      res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to normalized logs' })}\n\n`);

      // Pipe the stream to the response
      stream.on('data', (chunk: any) => {
        // The stream already provides SSE-formatted data
        logger.debug(`[normalized-logs] Stream data received: ${chunk.toString().substring(0, 200)}`);
        res.write(chunk);
      });

      stream.on('end', () => {
        res.end();
      });

      stream.on('error', (error: Error) => {
        logger.error(`Error streaming normalized logs for execution ${id}:`, error);
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
        res.end();
      });

      // Keep connection alive
      const keepAlive = setInterval(() => {
        if (!res.closed) {
          res.write(`: keepalive ${Date.now()}\n\n`);
        }
      }, 30000);

      const cleanup = () => {
        clearInterval(keepAlive);
        if (stream && typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
      };

      req.on('close', cleanup);
      req.on('error', cleanup);
    }

  } catch (error) {
    logger.error('Failed to stream normalized logs:', error);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to stream logs' })}\n\n`);
    res.end();
  }
});

// POST /api/execution-processes/:id/stop
router.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    const executionProcess = await models.getExecutionProcessModel().findById(id);

    if (!executionProcess) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Execution process not found'
      });
    }

    await deployment.stopExecutionProcess(id);

    logger.info(`Execution process ${id} stopped`);

    res.json({
      success: true,
      data: null,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to stop execution process:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to stop execution process'
    });
  }
});

// GET /api/execution-processes/running
router.get('/running', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    const models = deployment.getModels();
    
    const runningProcesses = await models.getExecutionProcessModel().findRunning();

    res.json({
      success: true,
      data: runningProcesses,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get running execution processes:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get running execution processes'
    });
  }
});

export const executionProcessRoutes = router;
