import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DeploymentService } from '../services/deployment';

const router = Router();

const CreateTaskSchema = z.object({
  project_id: z.string().uuid(),
  parent_task_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['todo', 'inprogress', 'done', 'cancelled', 'inreview']).optional()
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'inprogress', 'done', 'cancelled', 'inreview']).optional(),
  parent_task_id: z.string().uuid().nullable().optional()
});

router.get('/', async (req: Request, res: Response) => {
  const deployment: DeploymentService = req.app.locals.deployment;
  const projectId = req.query.project_id as string | undefined;
  const tasks = await deployment.getTasks(projectId);
  res.json(tasks);
});

router.get('/:id', async (req: Request, res: Response) => {
  const deployment: DeploymentService = req.app.locals.deployment;
  const db = req.app.locals.db;
  const conn = db.getConnection();

  const task = await conn('tasks').where('id', req.params.id).first();
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

router.post('/', async (req: Request, res: Response) => {
  const body = CreateTaskSchema.parse(req.body);
  const deployment: DeploymentService = req.app.locals.deployment;
  
  const task = await deployment.createTask(
    body.project_id,
    body.title,
    body.description
  );

  if (body.status) {
    await deployment.updateTask(task.id, { status: body.status });
  }

  if (body.parent_task_id) {
    await deployment.updateTask(task.id, { parent_task_id: body.parent_task_id });
  }

  res.status(201).json(task);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const body = UpdateTaskSchema.parse(req.body);
  const deployment: DeploymentService = req.app.locals.deployment;
  
  const task = await deployment.updateTask(req.params.id, body);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const db = req.app.locals.db;
  const conn = db.getConnection();

  const task = await conn('tasks').where('id', req.params.id).first();
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  await conn('tasks').where('id', req.params.id).delete();
  res.status(204).send();
});

router.get('/:id/attempts', async (req: Request, res: Response) => {
  const db = req.app.locals.db;
  const conn = db.getConnection();

  const attempts = await conn('task_attempts')
    .where('task_id', req.params.id)
    .orderBy('created_at', 'desc');

  res.json(attempts);
});

router.post('/:id/execute', async (req: Request, res: Response) => {
  const deployment: DeploymentService = req.app.locals.deployment;
  const db = req.app.locals.db;
  const conn = db.getConnection();

  const task = await conn('tasks').where('id', req.params.id).first();
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  await deployment.updateTask(task.id, { status: 'inprogress' });

  res.json({ 
    message: 'Task execution started',
    task_id: task.id 
  });
});

export const taskRoutes = router;