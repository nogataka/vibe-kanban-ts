import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';

const router = Router();

const CreatePullRequestSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  head: z.string(),
  base: z.string(),
  draft: z.boolean().optional()
});

const CreateIssueSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional()
});

async function getGitHubToken(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
}

router.get('/repos/:owner/:repo', async (req: Request, res: Response) => {
  const token = getGitHubToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No GitHub token provided' });
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${req.params.owner}/${req.params.repo}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch repository:', error);
    res.status(500).json({ error: 'Failed to fetch repository' });
  }
});

router.get('/repos/:owner/:repo/pulls', async (req: Request, res: Response) => {
  const token = getGitHubToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No GitHub token provided' });
  }

  try {
    const queryParams = new URLSearchParams({
      state: req.query.state as string || 'open',
      per_page: req.query.per_page as string || '30',
      page: req.query.page as string || '1'
    });

    const response = await fetch(
      `https://api.github.com/repos/${req.params.owner}/${req.params.repo}/pulls?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch pull requests:', error);
    res.status(500).json({ error: 'Failed to fetch pull requests' });
  }
});

router.post('/repos/:owner/:repo/pulls', async (req: Request, res: Response) => {
  const token = getGitHubToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No GitHub token provided' });
  }

  try {
    const body = CreatePullRequestSchema.parse(req.body);

    const response = await fetch(
      `https://api.github.com/repos/${req.params.owner}/${req.params.repo}/pulls`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error.message || `GitHub API returned ${response.status}`);
    }

    const data = await response.json();
    res.status(201).json(data);
  } catch (error) {
    logger.error('Failed to create pull request:', error);
    res.status(500).json({ error: 'Failed to create pull request' });
  }
});

router.get('/repos/:owner/:repo/issues', async (req: Request, res: Response) => {
  const token = getGitHubToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No GitHub token provided' });
  }

  try {
    const queryParams = new URLSearchParams({
      state: req.query.state as string || 'open',
      per_page: req.query.per_page as string || '30',
      page: req.query.page as string || '1'
    });

    const response = await fetch(
      `https://api.github.com/repos/${req.params.owner}/${req.params.repo}/issues?${queryParams}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch issues:', error);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
});

router.post('/repos/:owner/:repo/issues', async (req: Request, res: Response) => {
  const token = getGitHubToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No GitHub token provided' });
  }

  try {
    const body = CreateIssueSchema.parse(req.body);

    const response = await fetch(
      `https://api.github.com/repos/${req.params.owner}/${req.params.repo}/issues`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error.message || `GitHub API returned ${response.status}`);
    }

    const data = await response.json();
    res.status(201).json(data);
  } catch (error) {
    logger.error('Failed to create issue:', error);
    res.status(500).json({ error: 'Failed to create issue' });
  }
});

export const githubRoutes = router;