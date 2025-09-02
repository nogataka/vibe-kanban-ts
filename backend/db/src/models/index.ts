// Export all types
export * from './types';

// Export all models
export { ProjectModel } from './project';
export { TaskModel } from './task';
export { TaskAttemptModel } from './taskAttempt';
export { ExecutionProcessModel } from './executionProcess';
export { ExecutorSessionModel } from './executorSession';
export { TaskTemplateModel } from './taskTemplate';
export { ImageModel } from './image';
export { MergeModel } from './merge';
export { ExecutionProcessLogModel } from './executionProcessLog';

// Model factory for dependency injection
import { Knex } from 'knex';
import { ProjectModel } from './project';
import { TaskModel } from './task';
import { TaskAttemptModel } from './taskAttempt';
import { ExecutionProcessModel } from './executionProcess';
import { ExecutorSessionModel } from './executorSession';
import { TaskTemplateModel } from './taskTemplate';
import { ImageModel } from './image';
import { MergeModel } from './merge';
import { ExecutionProcessLogModel } from './executionProcessLog';

export class ModelFactory {
  private projectModel: ProjectModel;
  private taskModel: TaskModel;
  private taskAttemptModel: TaskAttemptModel;
  private executionProcessModel: ExecutionProcessModel;
  private executorSessionModel: ExecutorSessionModel;
  private taskTemplateModel: TaskTemplateModel;
  private imageModel: ImageModel;
  private mergeModel: MergeModel;
  private executionProcessLogModel: ExecutionProcessLogModel;

  constructor(private db: Knex) {
    this.projectModel = new ProjectModel(db);
    this.taskModel = new TaskModel(db);
    this.taskAttemptModel = new TaskAttemptModel(db);
    this.executionProcessModel = new ExecutionProcessModel(db);
    this.executorSessionModel = new ExecutorSessionModel(db);
    this.taskTemplateModel = new TaskTemplateModel(db);
    this.imageModel = new ImageModel(db);
    this.mergeModel = new MergeModel(db);
    this.executionProcessLogModel = new ExecutionProcessLogModel(db);
  }

  getProjectModel(): ProjectModel {
    return this.projectModel;
  }

  getTaskModel(): TaskModel {
    return this.taskModel;
  }

  getTaskAttemptModel(): TaskAttemptModel {
    return this.taskAttemptModel;
  }

  getExecutionProcessModel(): ExecutionProcessModel {
    return this.executionProcessModel;
  }

  getExecutorSessionModel(): ExecutorSessionModel {
    return this.executorSessionModel;
  }

  getTaskTemplateModel(): TaskTemplateModel {
    return this.taskTemplateModel;
  }

  getImageModel(): ImageModel {
    return this.imageModel;
  }

  getMergeModel(): MergeModel {
    return this.mergeModel;
  }

  getExecutionProcessLogModel(): ExecutionProcessLogModel {
    return this.executionProcessLogModel;
  }

  // Convenient method to get all models
  getAllModels() {
    return {
      project: this.projectModel,
      task: this.taskModel,
      taskAttempt: this.taskAttemptModel,
      executionProcess: this.executionProcessModel,
      executorSession: this.executorSessionModel,
      taskTemplate: this.taskTemplateModel,
      image: this.imageModel,
      merge: this.mergeModel,
      executionProcessLog: this.executionProcessLogModel
    };
  }
}
