import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import 'express-async-errors';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { DeploymentService } from './services/deployment';
import { DatabaseService } from './services/database';
import { setupRoutes } from './routes';
import { MCPServer } from './mcp/server';
import { openBrowser } from './utils/browser';
import { writePortFile } from './utils/portFile';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

async function main() {
  try {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const port = parseInt(process.env.BACKEND_PORT || process.env.PORT || '0', 10);
    const host = process.env.HOST || '127.0.0.1';

    const assetDir = path.join(process.cwd(), 'assets');
    await fs.mkdir(assetDir, { recursive: true });

    const db = await DatabaseService.getInstance();
    await db.initialize();

    const deployment = new DeploymentService(db);
    await deployment.initialize();
    await deployment.cleanupOrphanExecutions();
    deployment.spawnPRMonitorService();
    await deployment.trackAnalytics('session_start', {});

    app.use(helmet({
      contentSecurityPolicy: false,
    }));
    app.use(cors());
    app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.locals.deployment = deployment;
    app.locals.db = db;
    app.locals.wss = wss;

    setupRoutes(app);

    app.use(errorHandler);

    const mcpServer = new MCPServer(deployment, db);
    await mcpServer.initialize();

    const server = httpServer.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      
      logger.info(`Server running on http://${host}:${actualPort}`);

      if (!isDevelopment) {
        writePortFile(actualPort).catch((err) => {
          logger.warn(`Failed to write port file: ${err}`);
        });

        logger.info('Opening browser...');
        openBrowser(`http://127.0.0.1:${actualPort}`).catch((err) => {
          logger.warn(`Failed to open browser automatically: ${err}. Please open http://127.0.0.1:${actualPort} manually.`);
        });
      }
    });

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();