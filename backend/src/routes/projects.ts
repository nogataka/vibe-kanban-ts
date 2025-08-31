import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DeploymentService } from '../services/deployment';
import { DatabaseService } from '../services/database';

const router = Router();

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  git_repo_path: z.string().optional(),
  setup_script: z.string().optional(),
  cleanup_script: z.string().optional()
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  git_repo_path: z.string().optional(),
  setup_script: z.string().optional(),
  cleanup_script: z.string().optional()
});

router.get('/', async (req: Request, res: Response) => {
  const deployment: DeploymentService = req.app.locals.deployment;
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const projects = await conn('projects').select('*').orderBy('created_at', 'desc');
  res.json(projects);
});

router.get('/:id', async (req: Request, res: Response) => {
  const deployment: DeploymentService = req.app.locals.deployment;
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const project = await conn('projects')
    .where('id', req.params.id)
    .first();

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.json(project);
});

router.post('/', async (req: Request, res: Response) => {
  const body = CreateProjectSchema.parse(req.body);
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const id = uuidv4();
  const now = new Date();

  await conn('projects').insert({
    id,
    name: body.name,
    git_repo_path: body.git_repo_path || process.cwd(),
    setup_script: body.setup_script || '',
    cleanup_script: body.cleanup_script || '',
    created_at: now,
    updated_at: now
  });

  const project = await conn('projects').where('id', id).first();
  res.status(201).json(project);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const body = UpdateProjectSchema.parse(req.body);
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const project = await conn('projects')
    .where('id', req.params.id)
    .first();

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  await conn('projects')
    .where('id', req.params.id)
    .update({
      ...body,
      updated_at: new Date()
    });

  const updatedProject = await conn('projects').where('id', req.params.id).first();
  res.json(updatedProject);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const project = await conn('projects')
    .where('id', req.params.id)
    .first();

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  await conn('projects').where('id', req.params.id).delete();
  res.status(204).send();
});

router.get('/:id/tasks', async (req: Request, res: Response) => {
  const deployment: DeploymentService = req.app.locals.deployment;
  const tasks = await deployment.getTasks(req.params.id);
  res.json(tasks);
});

export const projectRoutes = router;