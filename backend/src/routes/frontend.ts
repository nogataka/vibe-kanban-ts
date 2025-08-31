import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs/promises';

const router = Router();

router.get('*', async (req: Request, res: Response) => {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (isDevelopment) {
    const frontendPort = process.env.FRONTEND_PORT || '3000';
    res.redirect(`http://localhost:${frontendPort}${req.originalUrl}`);
  } else {
    const frontendPath = path.join(process.cwd(), 'frontend', 'dist');
    const indexPath = path.join(frontendPath, 'index.html');

    try {
      await fs.access(indexPath);
      res.sendFile(indexPath);
    } catch {
      res.status(404).json({ 
        error: 'Frontend not built. Run npm run build in the frontend directory.' 
      });
    }
  }
});

export const frontendRoutes = router;