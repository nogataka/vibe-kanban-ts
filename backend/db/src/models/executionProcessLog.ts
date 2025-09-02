import { Knex } from 'knex';
import { ExecutionProcessLogs } from './types';

export class ExecutionProcessLogModel {
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

  private mapDbToExecutionProcessLogs(row: any): ExecutionProcessLogs {
    return {
      execution_id: this.bufferToUuid(row.execution_id),
      logs: row.logs,
      byte_size: row.byte_size,
      inserted_at: new Date(row.inserted_at)
    };
  }

  async findByExecutionId(executionId: string): Promise<ExecutionProcessLogs | null> {
    const row = await this.db('execution_process_logs')
      .where('execution_id', this.uuidToBuffer(executionId))
      .first();
    
    return row ? this.mapDbToExecutionProcessLogs(row) : null;
  }

  async create(executionId: string, logs: string): Promise<ExecutionProcessLogs> {
    const now = new Date();
    const byteSize = Buffer.byteLength(logs, 'utf8');

    await this.db('execution_process_logs').insert({
      execution_id: this.uuidToBuffer(executionId),
      logs: logs,
      byte_size: byteSize,
      inserted_at: now
    });

    const log = await this.findByExecutionId(executionId);
    if (!log) {
      throw new Error('Failed to create execution process log');
    }

    return log;
  }

  /**
   * Upsert logs (insert or update) - matches Rust's ON CONFLICT DO UPDATE
   */
  async upsert(executionId: string, logs: string): Promise<ExecutionProcessLogs> {
    const now = new Date();
    const byteSize = Buffer.byteLength(logs, 'utf8');
    const executionIdBuffer = this.uuidToBuffer(executionId);

    // Check if record exists
    const existing = await this.db('execution_process_logs')
      .where('execution_id', executionIdBuffer)
      .first();

    if (existing) {
      // Update existing record
      await this.db('execution_process_logs')
        .where('execution_id', executionIdBuffer)
        .update({
          logs: logs,
          byte_size: byteSize,
          inserted_at: now
        });
    } else {
      // Insert new record
      await this.db('execution_process_logs').insert({
        execution_id: executionIdBuffer,
        logs: logs,
        byte_size: byteSize,
        inserted_at: now
      });
    }

    const log = await this.findByExecutionId(executionId);
    if (!log) {
      throw new Error('Failed to upsert execution process log');
    }

    return log;
  }

  async update(executionId: string, logs: string): Promise<ExecutionProcessLogs> {
    const byteSize = Buffer.byteLength(logs, 'utf8');

    await this.db('execution_process_logs')
      .where('execution_id', this.uuidToBuffer(executionId))
      .update({
        logs: logs,
        byte_size: byteSize,
        inserted_at: new Date()
      });

    const log = await this.findByExecutionId(executionId);
    if (!log) {
      throw new Error('Execution process log not found after update');
    }

    return log;
  }

  async appendLogs(executionId: string, newLogs: string): Promise<ExecutionProcessLogs> {
    const existing = await this.findByExecutionId(executionId);
    
    if (existing) {
      const combinedLogs = existing.logs + '\n' + newLogs;
      return await this.update(executionId, combinedLogs);
    } else {
      return await this.create(executionId, newLogs);
    }
  }

  async delete(executionId: string): Promise<number> {
    const result = await this.db('execution_process_logs')
      .where('execution_id', this.uuidToBuffer(executionId))
      .del();
    
    return result;
  }

  // Get logs as JSONL array (each line is a LogMsg)
  async getLogsAsArray(executionId: string): Promise<any[]> {
    const log = await this.findByExecutionId(executionId);
    if (!log) {
      return [];
    }

    return log.logs
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          // If parsing fails, return as plain text log
          return {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: line
          };
        }
      });
  }

  // Stream logs (for real-time updates)
  async *streamLogs(executionId: string, fromTimestamp?: Date): AsyncGenerator<any> {
    const logs = await this.getLogsAsArray(executionId);
    
    for (const log of logs) {
      if (fromTimestamp && new Date(log.timestamp) < fromTimestamp) {
        continue;
      }
      yield log;
    }
  }
}
