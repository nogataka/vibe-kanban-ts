import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { logger } from '../../../utils/src/logger';

const router = Router();

const ContainerQuerySchema = z.object({
  ref: z.string()
});

interface ContainerInfo {
  attempt_id: string;
  task_id: string;
  project_id: string;
}

// GET /api/containers/info
router.get('/info', async (req: Request, res: Response) => {
  try {
    // Check if ref parameter is provided (required)
    // Rust version returns plain text error
    if (!req.query.ref) {
      res.status(400);
      res.type('text/plain');
      return res.send('Failed to deserialize query string: missing field `ref`');
    }
    
    const query = ContainerQuerySchema.parse(req.query);
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Resolve container reference to get task attempt info
    const containerInfo = await deployment.resolveContainerRef(query.ref);
    
    if (!containerInfo) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Container reference not found'
      });
    }

    res.json({
      success: true,
      data: containerInfo,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get container info:', error);
    // Return 400 for validation errors, 500 for other errors
    const isValidationError = error instanceof z.ZodError;
    res.status(isValidationError ? 400 : 500).json({
      success: false,
      data: null,
      error_data: null,
      message: isValidationError ? 'Invalid parameters' : 'Failed to get container info'
    });
  }
});

export const containerRoutes = router;