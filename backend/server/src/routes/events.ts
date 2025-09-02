import { Router, Request, Response } from 'express';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { logger } from '../../../utils/src/logger';

const router = Router();

// GET /api/events - Server-Sent Events endpoint
router.get('/', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Get event stream from deployment service
    const eventStream = await deployment.streamEvents();
    
    // Send events to client
    eventStream.on('data', (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Handle client disconnect
    req.on('close', () => {
      logger.debug('SSE connection closed');
      eventStream.removeAllListeners();
    });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });

  } catch (error) {
    logger.error('Failed to establish SSE connection:', error);
    res.status(500).json({
      error: 'Failed to establish event stream',
      success: false
    });
  }
});

export const eventsRoutes = router;