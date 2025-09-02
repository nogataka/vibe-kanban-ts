export { ContainerManager, ContainerService, ContainerConfig, ContainerInfo, ContainerError } from './containerManager';

// Container service factory
import { ContainerManager } from './containerManager';
import { DBService } from '../../../db/src/dbService';
import { GitService } from '../git/gitService';

export class ContainerServiceFactory {
  private static instances: Map<string, ContainerManager> = new Map();

  static getInstance(db: DBService, git: GitService, projectPath?: string): ContainerManager {
    const key = projectPath || 'default';
    
    if (!ContainerServiceFactory.instances.has(key)) {
      ContainerServiceFactory.instances.set(key, new ContainerManager(db, git, projectPath));
    }
    
    return ContainerServiceFactory.instances.get(key)!;
  }

  static async cleanupAll(): Promise<void> {
    const instances = Array.from(ContainerServiceFactory.instances.values());
    
    for (const instance of instances) {
      await instance.cleanup();
    }
    
    ContainerServiceFactory.instances.clear();
  }

  static removeInstance(projectPath?: string): void {
    const key = projectPath || 'default';
    ContainerServiceFactory.instances.delete(key);
  }
}
