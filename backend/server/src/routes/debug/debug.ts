import { Router, Request, Response } from 'express';
import { DeploymentService } from '../../../../deployment/src/deploymentService';
import { logger } from '../../../../utils/src/logger';

const router = Router();

// GET /api/debug/process-managers - Show running process managers
router.get('/process-managers', async (req: Request, res: Response) => {
  try {
    const deployment: DeploymentService = req.app.locals.deployment;
    
    // Use reflection to access private fields (for debugging only)
    const processManagers = (deployment as any).processManagers;
    const msgStores = (deployment as any).msgStores;
    
    const status = {
      processManagers: {
        count: processManagers.size,
        executionIds: Array.from(processManagers.keys()),
        processes: Array.from(processManagers.entries()).map(([id, pm]) => ({
          executionId: id,
          pid: pm.getPid(),
          isRunning: pm.isRunning()
        }))
      },
      msgStores: {
        count: msgStores.size,
        executionIds: Array.from(msgStores.keys()),
        stores: Array.from(msgStores.entries()).map(([id, store]) => ({
          executionId: id,
          messageCount: store.getMessageCount(),
          isFinished: store.isFinished()
        }))
      }
    };
    
    res.json(status);
  } catch (error) {
    logger.error('Failed to get debug info:', error);
    res.status(500).json({
      error: 'Failed to get debug info',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// GET /api/debug/test-claude-code - Test claude-code directly
router.get('/test-claude-code', async (req: Request, res: Response) => {
  try {
    logger.info('🧪 Testing claude-code command directly...');
    
    const { spawn } = require('child_process');
    const testDir = req.query.dir as string || '/tmp';
    const command = 'npx -y @anthropic-ai/claude-code@latest --help';
    
    logger.info(`Testing command: ${command}`);
    logger.info(`Working directory: ${testDir}`);
    
    const child = spawn('sh', ['-c', command], {
      cwd: testDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    child.on('exit', (code) => {
      logger.info(`Test command exited with code: ${code}`);
      res.json({
        success: true,
        exitCode: code,
        stdout: stdout.substring(0, 1000), // First 1000 chars
        stderr: stderr.substring(0, 1000),
        command,
        workingDir: testDir
      });
    });
    
    child.on('error', (error) => {
      logger.error('Test command failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        command
      });
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        res.status(408).json({
          success: false,
          error: 'Command timed out',
          command
        });
      }
    }, 10000);
    
  } catch (error) {
    logger.error('Failed to test claude-code:', error);
    res.status(500).json({
      error: 'Failed to test claude-code',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export const debugRoutes = router;
