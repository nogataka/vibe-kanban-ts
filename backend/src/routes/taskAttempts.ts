import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DeploymentService } from '../services/deployment';
import { WorktreeManager } from '../services/worktree';
import { DatabaseService } from '../services/database';

const router = Router();

const CreateTaskAttemptSchema = z.object({
  task_id: z.string().uuid(),
  executor: z.string().optional()
});

const UpdateTaskAttemptSchema = z.object({
  merge_commit: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional()
});

router.get('/', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const taskId = req.query.task_id as string | undefined;
  
  let query = conn('task_attempts').select('*');
  if (taskId) {
    query = query.where('task_id', taskId);
  }
  
  const attempts = await query.orderBy('created_at', 'desc');
  res.json(attempts);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const attempt = await conn('task_attempts')
    .where('id', req.params.id)
    .first();

  if (!attempt) {
    return res.status(404).json({ error: 'Task attempt not found' });
  }

  res.json(attempt);
});

router.post('/', async (req: Request, res: Response) => {
  const body = CreateTaskAttemptSchema.parse(req.body);
  const deployment: DeploymentService = req.app.locals.deployment;
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const task = await conn('tasks').where('id', body.task_id).first();
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const project = await deployment.getProject(task.project_id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const worktreeManager = new WorktreeManager(project.git_repo_path);
  const worktreePath = await worktreeManager.createWorktree();

  const attempt = await deployment.createTaskAttempt(body.task_id, worktreePath);

  await conn('task_attempt_activities').insert({
    id: uuidv4(),
    task_attempt_id: attempt.id,
    status: 'init',
    created_at: new Date()
  });

  res.status(201).json(attempt);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const body = UpdateTaskAttemptSchema.parse(req.body);
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const attempt = await conn('task_attempts')
    .where('id', req.params.id)
    .first();

  if (!attempt) {
    return res.status(404).json({ error: 'Task attempt not found' });
  }

  await conn('task_attempts')
    .where('id', req.params.id)
    .update({
      ...body,
      updated_at: new Date()
    });

  const updatedAttempt = await conn('task_attempts')
    .where('id', req.params.id)
    .first();

  res.json(updatedAttempt);
});

router.get('/:id/activities', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const activities = await conn('task_attempt_activities')
    .where('task_attempt_id', req.params.id)
    .orderBy('created_at', 'asc');

  res.json(activities);
});

router.post('/:id/activities', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const attempt = await conn('task_attempts')
    .where('id', req.params.id)
    .first();

  if (!attempt) {
    return res.status(404).json({ error: 'Task attempt not found' });
  }

  const activity = {
    id: uuidv4(),
    task_attempt_id: req.params.id,
    status: req.body.status || 'init',
    note: req.body.note,
    created_at: new Date()
  };

  await conn('task_attempt_activities').insert(activity);
  res.status(201).json(activity);
});

export const taskAttemptRoutes = router;