import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';

const router = Router();
const eventEmitter = new EventEmitter();

export { eventEmitter };

function setupSSE(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write('retry: 10000\n\n');

  const keepAlive = setInterval(() => {
    res.write(':ping\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });

  return { keepAlive };
}

router.get('/processes/:id/logs', (req: Request, res: Response) => {
  const processId = req.params.id;
  const { keepAlive } = setupSSE(req, res);

  const logHandler = (data: any) => {
    if (data.processId === processId) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  eventEmitter.on('process:log', logHandler);

  req.on('close', () => {
    eventEmitter.off('process:log', logHandler);
    clearInterval(keepAlive);
  });
});

router.get('/task-attempts/:id/diff', (req: Request, res: Response) => {
  const attemptId = req.params.id;
  const { keepAlive } = setupSSE(req, res);

  const diffHandler = (data: any) => {
    if (data.attemptId === attemptId) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  eventEmitter.on('task:diff', diffHandler);

  req.on('close', () => {
    eventEmitter.off('task:diff', diffHandler);
    clearInterval(keepAlive);
  });
});

router.get('/tasks/:id/status', (req: Request, res: Response) => {
  const taskId = req.params.id;
  const { keepAlive } = setupSSE(req, res);

  const statusHandler = (data: any) => {
    if (data.taskId === taskId) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  eventEmitter.on('task:status', statusHandler);

  req.on('close', () => {
    eventEmitter.off('task:status', statusHandler);
    clearInterval(keepAlive);
  });
});

router.get('/global', (req: Request, res: Response) => {
  const { keepAlive } = setupSSE(req, res);

  const globalHandler = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventEmitter.on('global:event', globalHandler);

  req.on('close', () => {
    eventEmitter.off('global:event', globalHandler);
    clearInterval(keepAlive);
  });
});

export const eventsRoutes = router;