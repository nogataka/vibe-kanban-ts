import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../services/database';

const router = Router();

const CreateContainerSchema = z.object({
  name: z.string().min(1),
  image: z.string().min(1),
  config: z.object({
    ports: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    volumes: z.array(z.string()).optional()
  }).optional()
});

router.get('/', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const containers = await conn('containers')
    .select('*')
    .orderBy('created_at', 'desc');

  res.json(containers);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const container = await conn('containers')
    .where('id', req.params.id)
    .first();

  if (!container) {
    return res.status(404).json({ error: 'Container not found' });
  }

  res.json(container);
});

router.post('/', async (req: Request, res: Response) => {
  const body = CreateContainerSchema.parse(req.body);
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const id = uuidv4();
  const containerId = `vibe-${id.slice(0, 8)}`;
  const now = new Date();

  await conn('containers').insert({
    id,
    container_id: containerId,
    name: body.name,
    status: 'stopped',
    config: JSON.stringify(body.config || {}),
    created_at: now,
    updated_at: now
  });

  const container = await conn('containers').where('id', id).first();
  res.status(201).json(container);
});

router.post('/:id/start', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const container = await conn('containers')
    .where('id', req.params.id)
    .first();

  if (!container) {
    return res.status(404).json({ error: 'Container not found' });
  }

  await conn('containers')
    .where('id', req.params.id)
    .update({
      status: 'running',
      updated_at: new Date()
    });

  res.json({ message: 'Container started', id: req.params.id });
});

router.post('/:id/stop', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const container = await conn('containers')
    .where('id', req.params.id)
    .first();

  if (!container) {
    return res.status(404).json({ error: 'Container not found' });
  }

  await conn('containers')
    .where('id', req.params.id)
    .update({
      status: 'stopped',
      updated_at: new Date()
    });

  res.json({ message: 'Container stopped', id: req.params.id });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const db: DatabaseService = req.app.locals.db;
  const conn = db.getConnection();

  const container = await conn('containers')
    .where('id', req.params.id)
    .first();

  if (!container) {
    return res.status(404).json({ error: 'Container not found' });
  }

  await conn('containers').where('id', req.params.id).delete();
  res.status(204).send();
});

export const containerRoutes = router;