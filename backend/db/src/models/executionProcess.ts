import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { 
  ExecutionProcess,
  ExecutionContext,
  CreateExecutionProcess,
  UpdateExecutionProcess,
  ExecutionProcessStatus,
  ExecutionProcessRunReason,
  ExecutorActionField,
  TaskAttempt,
  Task
} from './types';
import { TaskAttemptModel } from './taskAttempt';
import { TaskModel } from './task';

export class ExecutionProcessModel {
  constructor(private db: Knex) {}

  private uuidToBuffer(uuid: string): Buffer {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
  }

  private bufferToUuid(buffer: Buffer): string {
    const hex = buffer.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join('-');
  }

  private mapDbToExecutionProcess(row: any): ExecutionProcess {
    return {
      id: this.bufferToUuid(row.id),
      task_attempt_id: this.bufferToUuid(row.task_attempt_id),
      run_reason: row.run_reason as ExecutionProcessRunReason,
      executor_action: typeof row.executor_action === 'string' ? 
        JSON.parse(row.executor_action) : row.executor_action,
      status: row.status as ExecutionProcessStatus,
      exit_code: row.exit_code || undefined,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  async findById(id: string): Promise<ExecutionProcess | null> {
    const row = await this.db('execution_processes')
      .where('id', this.uuidToBuffer(id))
      .first();
    
    return row ? this.mapDbToExecutionProcess(row) : null;
  }

  async findByRowid(rowid: number): Promise<ExecutionProcess | null> {
    const row = await this.db('execution_processes')
      .where('rowid', rowid)
      .first();
    
    return row ? this.mapDbToExecutionProcess(row) : null;
  }

  async findByTaskAttemptId(taskAttemptId: string): Promise<ExecutionProcess[]> {
    const rows = await this.db('execution_processes')
      .where('task_attempt_id', this.uuidToBuffer(taskAttemptId))
      .orderBy('created_at', 'asc');
    
    return rows.map(row => this.mapDbToExecutionProcess(row));
  }

  async findRunning(): Promise<ExecutionProcess[]> {
    const rows = await this.db('execution_processes')
      .where('status', ExecutionProcessStatus.RUNNING)
      .orderBy('created_at', 'asc');
    
    return rows.map(row => this.mapDbToExecutionProcess(row));
  }

  async findRunningDevServersByProject(projectId: string): Promise<ExecutionProcess[]> {
    const rows = await this.db.raw(`
      SELECT ep.id, ep.task_attempt_id, ep.run_reason, ep.executor_action, ep.status,
             ep.exit_code, ep.started_at, ep.completed_at, ep.created_at, ep.updated_at
      FROM execution_processes ep
      JOIN task_attempts ta ON ep.task_attempt_id = ta.id
      JOIN tasks t ON ta.task_id = t.id
      WHERE ep.status = ? 
      AND ep.run_reason = ?
      AND t.project_id = ?
      ORDER BY ep.created_at ASC
    `, [ExecutionProcessStatus.RUNNING, ExecutionProcessRunReason.DEV_SERVER, this.uuidToBuffer(projectId)]);
    
    return rows.map((row: any) => this.mapDbToExecutionProcess(row));
  }

  async findLatestSessionIdByTaskAttempt(taskAttemptId: string): Promise<string | null> {
    const result = await this.db.raw(`
      SELECT es.session_id
      FROM execution_processes ep
      JOIN executor_sessions es ON ep.id = es.execution_process_id  
      WHERE ep.task_attempt_id = ?
        AND ep.run_reason = ?
        AND es.session_id IS NOT NULL
      ORDER BY ep.created_at DESC
      LIMIT 1
    `, [this.uuidToBuffer(taskAttemptId), ExecutionProcessRunReason.CODING_AGENT]);

    return result && result.length > 0 && result[0].session_id ? result[0].session_id : null;
  }

  async findLatestByTaskAttemptAndRunReason(
    taskAttemptId: string, 
    runReason: ExecutionProcessRunReason
  ): Promise<ExecutionProcess | null> {
    const row = await this.db('execution_processes')
      .where('task_attempt_id', this.uuidToBuffer(taskAttemptId))
      .where('run_reason', runReason)
      .orderBy('created_at', 'desc')
      .first();
    
    return row ? this.mapDbToExecutionProcess(row) : null;
  }

  async create(data: CreateExecutionProcess, processId?: string): Promise<ExecutionProcess> {
    const id = processId || uuidv4();
    const now = new Date();

    await this.db('execution_processes').insert({
      id: this.uuidToBuffer(id),
      task_attempt_id: this.uuidToBuffer(data.task_attempt_id),
      run_reason: data.run_reason,
      executor_action: JSON.stringify(data.executor_action),
      status: ExecutionProcessStatus.RUNNING,
      exit_code: null,
      started_at: now,
      completed_at: null,
      created_at: now,
      updated_at: now
    });

    const executionProcess = await this.findById(id);
    if (!executionProcess) {
      throw new Error('Failed to create execution process');
    }

    return executionProcess;
  }

  async wasKilled(id: string): Promise<boolean> {
    const executionProcess = await this.findById(id);
    return Boolean(executionProcess?.status === ExecutionProcessStatus.KILLED);
  }

  async updateCompletion(
    id: string,
    status: ExecutionProcessStatus,
    exitCode?: number
  ): Promise<void> {
    const completedAt = status === ExecutionProcessStatus.RUNNING ? null : new Date();
    
    await this.db('execution_processes')
      .where('id', this.uuidToBuffer(id))
      .update({
        status,
        exit_code: exitCode || null,
        completed_at: completedAt,
        updated_at: new Date()
      });
  }

  async deleteByTaskAttemptId(taskAttemptId: string): Promise<void> {
    await this.db('execution_processes')
      .where('task_attempt_id', this.uuidToBuffer(taskAttemptId))
      .del();
  }

  // Get the executor action safely
  getExecutorAction(executionProcess: ExecutionProcess): ExecutorActionField {
    return executionProcess.executor_action;
  }

  // Get the parent TaskAttempt for this execution process
  async getParentTaskAttempt(
    executionProcess: ExecutionProcess,
    taskAttemptModel: TaskAttemptModel
  ): Promise<TaskAttempt | null> {
    return await taskAttemptModel.findById(executionProcess.task_attempt_id);
  }

  // Load execution context with related task attempt and task
  async loadContext(
    execId: string,
    taskAttemptModel: TaskAttemptModel,
    taskModel: TaskModel
  ): Promise<ExecutionContext> {
    const executionProcess = await this.findById(execId);
    if (!executionProcess) {
      throw new Error('Execution process not found');
    }

    const taskAttempt = await taskAttemptModel.findById(executionProcess.task_attempt_id);
    if (!taskAttempt) {
      throw new Error('Task attempt not found');
    }

    const task = await taskModel.findById(taskAttempt.task_id);
    if (!task) {
      throw new Error('Task not found');
    }

    return {
      execution_process: executionProcess,
      task_attempt: taskAttempt,
      task
    };
  }
}
