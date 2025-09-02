import { EventEmitter } from 'events';
import { DBService } from '../../../../db/src/dbService';
import { logger } from '../../../../utils/src/logger';
import {
  Task,
  TaskAttempt,
  ExecutionProcess
} from '../../../../db/src/models/types';

export class EventServiceError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'EventServiceError';
  }
}

export enum RecordType {
  TASK = 'TASK',
  TASK_ATTEMPT = 'TASK_ATTEMPT',
  EXECUTION_PROCESS = 'EXECUTION_PROCESS',
  DELETED_TASK = 'DELETED_TASK',
  DELETED_TASK_ATTEMPT = 'DELETED_TASK_ATTEMPT',
  DELETED_EXECUTION_PROCESS = 'DELETED_EXECUTION_PROCESS'
}

export interface EventRecord {
  type: RecordType;
  data: Task | TaskAttempt | ExecutionProcess | { rowid: number };
}

export interface EventPatchInner {
  db_op: string;
  record: EventRecord;
}

export interface EventPatch {
  op: string;
  path: string;
  value: EventPatchInner;
  id: number;
  timestamp: Date;
}

export interface ServerSentEvent {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

export class MsgStore {
  private messages: EventPatch[] = [];
  private maxSize: number = 1000;
  private eventEmitter: EventEmitter = new EventEmitter();

  constructor(maxSize?: number) {
    if (maxSize) {
      this.maxSize = maxSize;
    }
  }

  /**
   * Add a new event patch to the store
   */
  push(patch: EventPatch): void {
    // Add timestamp if not provided
    if (!patch.timestamp) {
      patch.timestamp = new Date();
    }

    this.messages.push(patch);

    // Keep only the most recent messages
    if (this.messages.length > this.maxSize) {
      this.messages = this.messages.slice(-this.maxSize);
    }

    // Emit the new patch to listeners
    this.eventEmitter.emit('patch', patch);
  }

  /**
   * Get all stored messages
   */
  getHistory(): EventPatch[] {
    return [...this.messages];
  }

  /**
   * Get messages after a specific ID
   */
  getMessagesAfter(id: number): EventPatch[] {
    return this.messages.filter(msg => msg.id > id);
  }

  /**
   * Subscribe to new messages
   */
  onNewMessage(callback: (patch: EventPatch) => void): () => void {
    this.eventEmitter.on('patch', callback);
    
    // Return unsubscribe function
    return () => {
      this.eventEmitter.off('patch', callback);
    };
  }

  /**
   * Convert event patch to Server-Sent Events format
   */
  toSSE(patch: EventPatch): ServerSentEvent {
    return {
      id: patch.id.toString(),
      event: 'patch',
      data: JSON.stringify(patch),
      retry: 1000
    };
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Get current message count
   */
  size(): number {
    return this.messages.length;
  }
}

export class EventService {
  private msgStore: MsgStore;
  private db: DBService;
  private entryCount: number = 0;

  constructor(db: DBService, maxStoreSize?: number) {
    this.db = db;
    this.msgStore = new MsgStore(maxStoreSize);
  }

  /**
   * Get the message store for direct access
   */
  getMsgStore(): MsgStore {
    return this.msgStore;
  }

  /**
   * Emit a database operation event
   */
  async emitDatabaseEvent(
    operation: 'INSERT' | 'UPDATE' | 'DELETE',
    tableName: string,
    recordData: any,
    rowid?: number
  ): Promise<void> {
    try {
      let recordType: RecordType;
      let record: EventRecord;

      // Determine record type based on table name
      switch (tableName.toLowerCase()) {
        case 'tasks':
          if (operation === 'DELETE') {
            recordType = RecordType.DELETED_TASK;
            record = {
              type: recordType,
              data: { rowid: rowid || 0 }
            };
          } else {
            recordType = RecordType.TASK;
            record = {
              type: recordType,
              data: recordData as Task
            };
          }
          break;

        case 'task_attempts':
          if (operation === 'DELETE') {
            recordType = RecordType.DELETED_TASK_ATTEMPT;
            record = {
              type: recordType,
              data: { rowid: rowid || 0 }
            };
          } else {
            recordType = RecordType.TASK_ATTEMPT;
            record = {
              type: recordType,
              data: recordData as TaskAttempt
            };
          }
          break;

        case 'execution_processes':
          if (operation === 'DELETE') {
            recordType = RecordType.DELETED_EXECUTION_PROCESS;
            record = {
              type: recordType,
              data: { rowid: rowid || 0 }
            };
          } else {
            recordType = RecordType.EXECUTION_PROCESS;
            record = {
              type: recordType,
              data: recordData as ExecutionProcess
            };
          }
          break;

        default:
          // Skip unknown tables
          return;
      }

      // Create event patch
      const patch: EventPatch = {
        op: 'replace',
        path: `/db/${tableName}`,
        value: {
          db_op: operation,
          record
        },
        id: ++this.entryCount,
        timestamp: new Date()
      };

      // Add to message store
      this.msgStore.push(patch);

      logger.debug(`Emitted database event: ${operation} on ${tableName}`, { 
        recordType,
        entryCount: this.entryCount
      });

    } catch (error) {
      logger.error('Failed to emit database event:', error);
    }
  }

  /**
   * Emit a custom application event
   */
  async emitCustomEvent(
    eventType: string,
    eventData: any,
    path?: string
  ): Promise<void> {
    try {
      const patch: EventPatch = {
        op: 'add',
        path: path || `/events/${eventType}`,
        value: {
          db_op: 'CUSTOM',
          record: {
            type: eventType as RecordType,
            data: eventData
          }
        },
        id: ++this.entryCount,
        timestamp: new Date()
      };

      this.msgStore.push(patch);

      logger.debug(`Emitted custom event: ${eventType}`, { 
        eventData,
        entryCount: this.entryCount
      });

    } catch (error) {
      logger.error('Failed to emit custom event:', error);
    }
  }

  /**
   * Get event history
   */
  getEventHistory(afterId?: number): EventPatch[] {
    if (afterId !== undefined) {
      return this.msgStore.getMessagesAfter(afterId);
    }
    return this.msgStore.getHistory();
  }

  /**
   * Subscribe to events with callback
   */
  subscribe(callback: (patch: EventPatch) => void): () => void {
    return this.msgStore.onNewMessage(callback);
  }

  /**
   * Create Server-Sent Events stream
   */
  createSSEStream(): {
    onConnection: (req: any, res: any) => void;
    onClose: (cleanup: () => void) => void;
  } {
    const activeConnections = new Set<any>();

    const onConnection = (req: any, res: any) => {
      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      // Send initial connection event
      const connectEvent: ServerSentEvent = {
        event: 'connected',
        data: JSON.stringify({ 
          timestamp: new Date().toISOString(),
          entryCount: this.entryCount 
        })
      };
      
      this.writeSSEMessage(res, connectEvent);

      // Send recent history
      const history = this.msgStore.getHistory();
      for (const patch of history.slice(-10)) { // Send last 10 events
        this.writeSSEMessage(res, this.msgStore.toSSE(patch));
      }

      // Subscribe to new events
      const unsubscribe = this.subscribe((patch: EventPatch) => {
        if (!res.destroyed) {
          this.writeSSEMessage(res, this.msgStore.toSSE(patch));
        }
      });

      // Track connection
      activeConnections.add(res);

      // Cleanup on connection close
      req.on('close', () => {
        activeConnections.delete(res);
        unsubscribe();
      });

      req.on('end', () => {
        activeConnections.delete(res);
        unsubscribe();
      });

      // Send periodic heartbeat
      const heartbeat = setInterval(() => {
        if (!res.destroyed) {
          this.writeSSEMessage(res, {
            event: 'heartbeat',
            data: JSON.stringify({ timestamp: new Date().toISOString() })
          });
        } else {
          clearInterval(heartbeat);
        }
      }, 30000); // Every 30 seconds

      // Clear heartbeat on close
      req.on('close', () => clearInterval(heartbeat));
      req.on('end', () => clearInterval(heartbeat));
    };

    const onClose = (cleanup: () => void) => {
      // Close all active connections
      for (const res of activeConnections) {
        if (!res.destroyed) {
          res.end();
        }
      }
      activeConnections.clear();
      cleanup();
    };

    return { onConnection, onClose };
  }

  /**
   * Write a Server-Sent Event message to response
   */
  private writeSSEMessage(res: any, event: ServerSentEvent): void {
    if (res.destroyed) return;

    try {
      if (event.id) {
        res.write(`id: ${event.id}\n`);
      }
      
      if (event.event) {
        res.write(`event: ${event.event}\n`);
      }
      
      if (event.retry) {
        res.write(`retry: ${event.retry}\n`);
      }

      // Split data by newlines for proper SSE format
      const dataLines = event.data.split('\n');
      for (const line of dataLines) {
        res.write(`data: ${line}\n`);
      }
      
      res.write('\n'); // End event with empty line
    } catch (error) {
      logger.error('Failed to write SSE message:', error);
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    entryCount: number;
    storeSize: number;
    storeMaxSize: number;
  } {
    return {
      entryCount: this.entryCount,
      storeSize: this.msgStore.size(),
      storeMaxSize: this.msgStore['maxSize']
    };
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.msgStore.clear();
    this.entryCount = 0;
  }
}
