import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: 'OK',
    error_data: null,
    message: null
  });
});

export const healthRoutes = router;