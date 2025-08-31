import { Express, Request, Response } from 'express';
import { healthRoutes } from './health';
import { authRoutes } from './auth';
import { projectRoutes } from './projects';
import { taskRoutes } from './tasks';
import { taskAttemptRoutes } from './taskAttempts';
import { configRoutes } from './config';
import { filesystemRoutes } from './filesystem';
import { githubRoutes } from './github';
import { eventsRoutes } from './events';
import { containerRoutes } from './containers';
import { taskTemplateRoutes } from './taskTemplates';
import { frontendRoutes } from './frontend';

export function setupRoutes(app: Express): void {
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/task-attempts', taskAttemptRoutes);
  app.use('/api/config', configRoutes);
  app.use('/api/filesystem', filesystemRoutes);
  app.use('/api/github', githubRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/containers', containerRoutes);
  app.use('/api/task-templates', taskTemplateRoutes);
  
  app.use('*', frontendRoutes);
}