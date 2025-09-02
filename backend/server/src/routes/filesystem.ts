import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { FilesystemError } from '../../../services/src/services/filesystem';
import { logger } from '../../../utils/src/logger';

const router = Router();

const ListDirectoryQuerySchema = z.object({
  path: z.string().optional()
});

const PathInfoQuerySchema = z.object({
  path: z.string()
});

// GET /api/filesystem/directory - List directory contents
router.get('/directory', async (req: Request, res: Response) => {
  try {
    const query = ListDirectoryQuerySchema.parse(req.query);
    const deployment: DeploymentService = req.app.locals.deployment;
    const filesystemService = deployment.getFilesystemService();

    const response = await filesystemService.listDirectory(query.path);

    res.json({
      success: true,
      data: response,
      error_data: null,
      message: null
    });
  } catch (error) {
    if (error instanceof FilesystemError) {
      switch (error.code) {
        case 'DIRECTORY_NOT_EXISTS':
          return res.status(404).json({
            success: false,
            data: null,
            error_data: null,
            message: 'Directory does not exist'
          });
        case 'PATH_NOT_DIRECTORY':
          return res.status(400).json({
            success: false,
            data: null,
            error_data: null,
            message: 'Path is not a directory'
          });
        default:
          return res.status(500).json({
            success: false,
            data: null,
            error_data: null,
            message: error.message
          });
      }
    }

    logger.error('Failed to list directory:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to read directory'
    });
  }
});

// GET /api/filesystem/git-repos - List Git repositories
router.get('/git-repos', async (req: Request, res: Response) => {
  try {
    const query = ListDirectoryQuerySchema.parse(req.query);
    const deployment: DeploymentService = req.app.locals.deployment;
    const filesystemService = deployment.getFilesystemService();

    const maxDepth = req.query.max_depth ? parseInt(req.query.max_depth as string, 10) : 4;
    const response = await filesystemService.listGitRepos(query.path, maxDepth);

    res.json({
      success: true,
      data: response,
      error_data: null,
      message: null
    });
  } catch (error) {
    if (error instanceof FilesystemError) {
      switch (error.code) {
        case 'DIRECTORY_NOT_EXISTS':
          return res.status(404).json({
            success: false,
            data: null,
            error_data: null,
            message: 'Directory does not exist'
          });
        case 'PATH_NOT_DIRECTORY':
          return res.status(400).json({
            success: false,
            data: null,
            error_data: null,
            message: 'Path is not a directory'
          });
        default:
          return res.status(500).json({
            success: false,
            data: null,
            error_data: null,
            message: error.message
          });
      }
    }

    logger.error('Failed to list git repositories:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to read git repositories'
    });
  }
});

// GET /api/filesystem/path-info - Get path information
router.get('/path-info', async (req: Request, res: Response) => {
  try {
    const query = PathInfoQuerySchema.parse(req.query);
    const deployment: DeploymentService = req.app.locals.deployment;
    const filesystemService = deployment.getFilesystemService();

    const pathInfo = await filesystemService.getPathInfo(query.path);

    res.json({
      success: true,
      data: pathInfo,
      error_data: null,
      message: null
    });
  } catch (error) {
    logger.error('Failed to get path info:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to get path information'
    });
  }
});

// POST /api/filesystem/create-directory - Create directory
router.post('/create-directory', async (req: Request, res: Response) => {
  try {
    const { path: dirPath } = req.body;

    if (!dirPath) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Directory path is required'
      });
    }

    const deployment: DeploymentService = req.app.locals.deployment;
    const filesystemService = deployment.getFilesystemService();

    await filesystemService.createDirectory(dirPath);

    res.json({
      success: true,
      data: { message: 'Directory created successfully' },
      error_data: null,
      message: null
    });
  } catch (error) {
    if (error instanceof FilesystemError) {
      return res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: error.message
      });
    }

    logger.error('Failed to create directory:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to create directory'
    });
  }
});

// GET /api/filesystem/read-file - Read file contents
router.get('/read-file', async (req: Request, res: Response) => {
  try {
    const { path: filePath, encoding = 'utf-8' } = req.query;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'File path is required'
      });
    }

    const deployment: DeploymentService = req.app.locals.deployment;
    const filesystemService = deployment.getFilesystemService();

    const content = await filesystemService.readFile(filePath as string, encoding as BufferEncoding);

    res.json({
      success: true,
      data: { content },
      error_data: null,
      message: null
    });
  } catch (error) {
    if (error instanceof FilesystemError) {
      return res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: error.message
      });
    }

    logger.error('Failed to read file:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to read file'
    });
  }
});

// POST /api/filesystem/write-file - Write file contents
router.post('/write-file', async (req: Request, res: Response) => {
  try {
    const { path: filePath, content, encoding = 'utf-8' } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'File path and content are required'
      });
    }

    const deployment: DeploymentService = req.app.locals.deployment;
    const filesystemService = deployment.getFilesystemService();

    await filesystemService.writeFile(filePath, content, encoding);

    res.json({
      success: true,
      data: { message: 'File written successfully' },
      error_data: null,
      message: null
    });
  } catch (error) {
    if (error instanceof FilesystemError) {
      return res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: error.message
      });
    }

    logger.error('Failed to write file:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to write file'
    });
  }
});

// DELETE /api/filesystem/delete-path - Delete file or directory
router.delete('/delete-path', async (req: Request, res: Response) => {
  try {
    const { path: targetPath, recursive = false } = req.body;

    if (!targetPath) {
      return res.status(400).json({
        success: false,
        data: null,
        error_data: null,
        message: 'Path is required'
      });
    }

    const deployment: DeploymentService = req.app.locals.deployment;
    const filesystemService = deployment.getFilesystemService();

    await filesystemService.deletePath(targetPath, recursive);

    res.json({
      success: true,
      data: { message: 'Path deleted successfully' },
      error_data: null,
      message: null
    });
  } catch (error) {
    if (error instanceof FilesystemError) {
      return res.status(500).json({
        success: false,
        data: null,
        error_data: null,
        message: error.message
      });
    }

    logger.error('Failed to delete path:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: null,
      message: 'Failed to delete path'
    });
  }
});

export const filesystemRoutes = router;
