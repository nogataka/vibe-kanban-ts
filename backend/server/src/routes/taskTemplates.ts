import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../../../services/src/services/database';

const router = Router();

const CreateTemplateSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  template_data: z.object({
    title: z.string(),
    description: z.string().optional(),
    executor: z.string().optional(),
    setup_commands: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional()
  })
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  template_data: z.object({
    title: z.string(),
    description: z.string().optional(),
    executor: z.string().optional(),
    setup_commands: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional()
  }).optional()
});

router.get('/', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  let query = conn('task_templates').select('*');
  
  if (req.query.project_id) {
    query = query.where('project_id', req.query.project_id as string);
  }

  const templates = await query.orderBy('created_at', 'desc');
  res.json(templates);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const template = await conn('task_templates')
    .where('id', req.params.id)
    .first();

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  res.json(template);
});

router.post('/', async (req: Request, res: Response) => {
  const body = CreateTemplateSchema.parse(req.body);
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const project = await conn('projects')
    .where('id', body.project_id)
    .first();

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const id = uuidv4();
  const now = new Date();

  await conn('task_templates').insert({
    id,
    project_id: body.project_id,
    name: body.name,
    description: body.description || '',
    template_data: JSON.stringify(body.template_data),
    created_at: now,
    updated_at: now
  });

  const template = await conn('task_templates').where('id', id).first();
  res.status(201).json(template);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const body = UpdateTemplateSchema.parse(req.body);
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const template = await conn('task_templates')
    .where('id', req.params.id)
    .first();

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const updates: any = {
    updated_at: new Date()
  };

  if (body.name) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.template_data) updates.template_data = JSON.stringify(body.template_data);

  await conn('task_templates')
    .where('id', req.params.id)
    .update(updates);

  const updatedTemplate = await conn('task_templates')
    .where('id', req.params.id)
    .first();

  res.json(updatedTemplate);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const template = await conn('task_templates')
    .where('id', req.params.id)
    .first();

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  await conn('task_templates').where('id', req.params.id).delete();
  res.status(204).send();
});

router.post('/:id/create-task', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();
  const deployment = req.app.locals.deployment;

  const template = await conn('task_templates')
    .where('id', req.params.id)
    .first();

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const templateData = JSON.parse(template.template_data || '{}');
  
  const task = await deployment.createTask(
    template.project_id,
    templateData.title || 'Task from template',
    templateData.description
  );

  res.status(201).json(task);
});

export const taskTemplateRoutes = router;