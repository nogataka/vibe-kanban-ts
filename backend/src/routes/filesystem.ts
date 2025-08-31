import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

const router = Router();

const ListDirectorySchema = z.object({
  path: z.string()
});

const ReadFileSchema = z.object({
  path: z.string()
});

const WriteFileSchema = z.object({
  path: z.string(),
  content: z.string()
});

router.post('/list', async (req: Request, res: Response) => {
  try {
    const body = ListDirectorySchema.parse(req.body);
    const targetPath = path.resolve(body.path);

    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    
    const items = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(targetPath, entry.name);
      const stats = await fs.stat(fullPath);
      
      return {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime
      };
    }));

    res.json({
      path: targetPath,
      items: items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Path not found' });
    }
    throw error;
  }
});

router.post('/read', async (req: Request, res: Response) => {
  try {
    const body = ReadFileSchema.parse(req.body);
    const targetPath = path.resolve(body.path);

    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is a directory' });
    }

    const content = await fs.readFile(targetPath, 'utf-8');
    
    res.json({
      path: targetPath,
      content,
      size: stats.size,
      modified: stats.mtime
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    throw error;
  }
});

router.post('/write', async (req: Request, res: Response) => {
  try {
    const body = WriteFileSchema.parse(req.body);
    const targetPath = path.resolve(body.path);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, body.content, 'utf-8');

    const stats = await fs.stat(targetPath);
    
    res.json({
      path: targetPath,
      size: stats.size,
      modified: stats.mtime
    });
  } catch (error: any) {
    if (error.code === 'EACCES') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    throw error;
  }
});

router.post('/delete', async (req: Request, res: Response) => {
  try {
    const body = z.object({ path: z.string() }).parse(req.body);
    const targetPath = path.resolve(body.path);

    const stats = await fs.stat(targetPath);
    
    if (stats.isDirectory()) {
      await fs.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.unlink(targetPath);
    }

    res.json({ message: 'Deleted successfully' });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Path not found' });
    }
    throw error;
  }
});

export const filesystemRoutes = router;