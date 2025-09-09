export { ExecutionManager, LogMessage } from './executionManager';

// Execution service factory
import { ExecutionManager } from './executionManager';
import { ModelFactory } from '../../../../db/src/models';

export class ExecutionServiceFactory {
  private static instance: ExecutionManager;

  static getInstance(models: ModelFactory): ExecutionManager {
    if (!ExecutionServiceFactory.instance) {
      ExecutionServiceFactory.instance = new ExecutionManager(models);
    }
    return ExecutionServiceFactory.instance;
  }

  static resetInstance(): void {
    if (ExecutionServiceFactory.instance) {
      ExecutionServiceFactory.instance.cleanup();
    }
    ExecutionServiceFactory.instance = null as any;
  }
}
