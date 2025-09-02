import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { 
  ExecutorSession,
  CreateExecutorSession,
  UpdateExecutorSession
} from './types';

export class ExecutorSessionModel {
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

  private mapDbToExecutorSession(row: any): ExecutorSession {
    return {
      id: this.bufferToUuid(row.id),
      task_attempt_id: this.bufferToUuid(row.task_attempt_id),
      execution_process_id: this.bufferToUuid(row.execution_process_id),
      session_id: row.session_id || undefined,
      prompt: row.prompt || undefined,
      summary: row.summary || undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  async findById(id: string): Promise<ExecutorSession | null> {
    const row = await this.db('executor_sessions')
      .where('id', this.uuidToBuffer(id))
      .first();
    
    return row ? this.mapDbToExecutorSession(row) : null;
  }

  async findByExecutionProcessId(executionProcessId: string): Promise<ExecutorSession | null> {
    const row = await this.db('executor_sessions')
      .where('execution_process_id', this.uuidToBuffer(executionProcessId))
      .first();
    
    return row ? this.mapDbToExecutorSession(row) : null;
  }

  async findByTaskAttemptId(taskAttemptId: string): Promise<ExecutorSession[]> {
    const rows = await this.db('executor_sessions')
      .where('task_attempt_id', this.uuidToBuffer(taskAttemptId))
      .orderBy('created_at', 'asc');
    
    return rows.map(row => this.mapDbToExecutorSession(row));
  }

  async create(data: CreateExecutorSession, sessionId?: string): Promise<ExecutorSession> {
    const id = sessionId || uuidv4();
    const now = new Date();

    await this.db('executor_sessions').insert({
      id: this.uuidToBuffer(id),
      task_attempt_id: this.uuidToBuffer(data.task_attempt_id),
      execution_process_id: this.uuidToBuffer(data.execution_process_id),
      session_id: null, // initially None until parsed from output
      prompt: data.prompt || null,
      summary: null, // initially None
      created_at: now,
      updated_at: now
    });

    const executorSession = await this.findById(id);
    if (!executorSession) {
      throw new Error('Failed to create executor session');
    }

    return executorSession;
  }

  async updateSessionId(executionProcessId: string, externalSessionId: string): Promise<void> {
    const now = new Date();
    await this.db('executor_sessions')
      .where('execution_process_id', this.uuidToBuffer(executionProcessId))
      .update({
        session_id: externalSessionId,
        updated_at: now
      });
  }

  async updatePrompt(id: string, prompt: string): Promise<void> {
    const now = new Date();
    await this.db('executor_sessions')
      .where('id', this.uuidToBuffer(id))
      .update({
        prompt: prompt,
        updated_at: now
      });
  }

  async updateSummary(executionProcessId: string, summary: string): Promise<void> {
    const now = new Date();
    await this.db('executor_sessions')
      .where('execution_process_id', this.uuidToBuffer(executionProcessId))
      .update({
        summary: summary,
        updated_at: now
      });
  }

  async deleteByTaskAttemptId(taskAttemptId: string): Promise<void> {
    await this.db('executor_sessions')
      .where('task_attempt_id', this.uuidToBuffer(taskAttemptId))
      .del();
  }
}
