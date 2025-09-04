import { 
  NormalizedEntry, 
  NormalizedEntryType, 
  LogProcessorOptions,
  MessageBoundary,
  MessageBoundaryResult,
  ConversationPatch,
  IEntryIndexProvider
} from './types';
import { MsgStore } from '../../../utils/src/msgStore';

/**
 * Internal buffer for collecting streaming text into individual lines
 */
class PlainTextBuffer {
  private lines: string[] = [];
  private totalLength: number = 0;

  constructor() {}

  /**
   * Ingest a new text chunk into the buffer
   */
  ingest(textChunk: string): void {
    if (!textChunk) return;

    // Handle partial line at the end
    let currentPartial = '';
    if (this.lines.length > 0 && !this.lines[this.lines.length - 1].endsWith('\n')) {
      currentPartial = this.lines.pop()!;
      this.totalLength -= currentPartial.length;
    }

    // Process chunk
    const combinedText = currentPartial + textChunk;
    const size = combinedText.length;

    // Split by lines, keeping newlines
    const parts = combinedText.split(/(\n)/);
    const lines: string[] = [];
    
    for (let i = 0; i < parts.length; i += 2) {
      const line = parts[i];
      const newline = parts[i + 1] || '';
      lines.push(line + newline);
    }

    this.lines.push(...lines);
    this.totalLength += size;
  }

  /**
   * Remove and return the first n buffered lines
   */
  drainLines(n: number): string[] {
    const actualN = Math.min(n, this.lines.length);
    const drained = this.lines.splice(0, actualN);

    for (const line of drained) {
      this.totalLength -= line.length;
    }

    return drained;
  }

  /**
   * Remove and return lines until the content length is at least len
   */
  drainSize(targetLength: number): string[] {
    const drained: string[] = [];
    let currentLength = 0;

    while (this.lines.length > 0 && currentLength < targetLength) {
      const line = this.lines.shift()!;
      drained.push(line);
      currentLength += line.length;
      this.totalLength -= line.length;
    }

    return drained;
  }

  /**
   * Get all buffered lines without removing them
   */
  peekLines(): string[] {
    return [...this.lines];
  }

  /**
   * Get current buffer statistics
   */
  getStats(): { lineCount: number; totalLength: number } {
    return {
      lineCount: this.lines.length,
      totalLength: this.totalLength
    };
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.lines.length === 0;
  }

  /**
   * Clear all buffered content
   */
  clear(): void {
    this.lines = [];
    this.totalLength = 0;
  }
}

/**
 * Clustering configuration for grouping messages
 */
interface ClusteringConfig {
  maxLineCount: number;
  maxBufferSize: number;
  timeGapThreshold: number;
}

/**
 * Plain text log processor for handling streaming executor output
 */
export class PlainTextProcessor {
  private buffer: PlainTextBuffer = new PlainTextBuffer();
  private lastProcessTime: number = Date.now();
  private options: Required<LogProcessorOptions>;

  constructor(options: LogProcessorOptions = {}) {
    this.options = {
      max_line_count: options.max_line_count ?? 50,
      max_buffer_size: options.max_buffer_size ?? 4096,
      time_gap_threshold: options.time_gap_threshold ?? 1000,
      formatter: options.formatter ?? ((chunk: string) => chunk),
      message_boundary_predicate: options.message_boundary_predicate ?? (() => null)
    };
  }

  /**
   * Process a new text chunk and potentially emit normalized entries
   */
  processChunk(
    textChunk: string,
    entryType: NormalizedEntryType,
    indexProvider: EntryIndexProvider
  ): NormalizedEntry[] {
    if (!textChunk) return [];

    this.buffer.ingest(textChunk);
    const entries: NormalizedEntry[] = [];

    // Check for message boundaries
    const lines = this.buffer.peekLines();
    const boundaryResult = this.options.message_boundary_predicate(lines, entryType);

    if (boundaryResult?.type === MessageBoundary.INCOMPLETE_CONTENT) {
      // Don't emit anything yet, content is incomplete
      return [];
    }

    if (boundaryResult?.type === MessageBoundary.SPLIT && boundaryResult.split_line !== undefined) {
      // Split at the specified line
      const splitLines = this.buffer.drainLines(boundaryResult.split_line);
      if (splitLines.length > 0) {
        const entry = this.createEntry(splitLines, entryType, indexProvider);
        entries.push(entry);
      }
    }

    // Check clustering conditions
    const shouldEmit = this.shouldEmitEntry();
    if (shouldEmit) {
      const bufferLines = this.buffer.drainLines(this.buffer.getStats().lineCount);
      if (bufferLines.length > 0) {
        const entry = this.createEntry(bufferLines, entryType, indexProvider);
        entries.push(entry);
      }
    }

    this.lastProcessTime = Date.now();
    return entries;
  }

  /**
   * Flush any remaining buffered content
   */
  flush(entryType: NormalizedEntryType, indexProvider: EntryIndexProvider): NormalizedEntry[] {
    if (this.buffer.isEmpty()) {
      return [];
    }

    const bufferLines = this.buffer.drainLines(this.buffer.getStats().lineCount);
    const entry = this.createEntry(bufferLines, entryType, indexProvider);
    return [entry];
  }

  /**
   * Check if we should emit an entry based on clustering rules
   */
  private shouldEmitEntry(): boolean {
    const stats = this.buffer.getStats();
    const currentTime = Date.now();
    const timeSinceLastProcess = currentTime - this.lastProcessTime;

    // Size-based clustering
    if (stats.lineCount >= this.options.max_line_count) {
      return true;
    }

    if (stats.totalLength >= this.options.max_buffer_size) {
      return true;
    }

    // Time-based clustering
    if (timeSinceLastProcess >= this.options.time_gap_threshold) {
      return true;
    }

    return false;
  }

  /**
   * Create a normalized entry from buffered lines
   */
  private createEntry(
    lines: string[],
    entryType: NormalizedEntryType,
    indexProvider: EntryIndexProvider
  ): NormalizedEntry {
    const content = lines.join('');
    const formattedContent = this.options.formatter(content);
    
    const entry: NormalizedEntry = {
      timestamp: new Date().toISOString(),
      entry_type: entryType,
      content: formattedContent.trim(),
      metadata: {
        original_line_count: lines.length,
        original_length: content.length,
        entry_index: indexProvider.get_current_entry_index()
      }
    };

    indexProvider.increment_entry_index();
    return entry;
  }

  /**
   * Get current buffer statistics
   */
  getBufferStats(): { lineCount: number; totalLength: number } {
    return this.buffer.getStats();
  }

  /**
   * Clear all buffered content
   */
  clearBuffer(): void {
    this.buffer.clear();
  }

  /**
   * Static method to process logs from a MsgStore
   */
  static async processLogs(
    msgStore: MsgStore,
    currentDir: string,
    entryIndexProvider: IEntryIndexProvider,
    executorType: string,
    formatChunk?: (content: string, accumulated: string) => string
  ): Promise<void> {
    const processor = new PlainTextProcessor({
      formatter: (chunk: string) => {
        if (formatChunk) {
          return formatChunk(chunk, '');
        }
        return chunk;
      }
    });
    
    // Listen to stdout events and process them
    msgStore.on('stdout', (content: string) => {
      const entries = processor.processChunk(
        content,
        { type: 'assistant_message' } as NormalizedEntryType,
        entryIndexProvider
      );
      
      // Push entries to msgStore as patches
      entries.forEach(entry => {
        const { ConversationPatch } = require('../conversationPatch');
        const patch = ConversationPatch.addNormalizedEntry(
          entryIndexProvider.get_current_entry_index(),
          entry
        );
        msgStore.pushPatch(patch);
      });
    });
    
    // Handle process completion
    msgStore.on('eof', () => {
      const entries = processor.flush(
        { type: 'assistant_message' } as NormalizedEntryType,
        entryIndexProvider
      );
      
      entries.forEach(entry => {
        const { ConversationPatch } = require('../conversationPatch');
        const patch = ConversationPatch.addNormalizedEntry(
          entryIndexProvider.get_current_entry_index(),
          entry
        );
        msgStore.pushPatch(patch);
      });
    });
  }
}

/**
 * Specialized processor for stderr streams
 */
export class StderrProcessor extends PlainTextProcessor {
  constructor() {
    super({
      max_line_count: 10,
      max_buffer_size: 2048,
      time_gap_threshold: 500,
      formatter: (chunk: string) => {
        // Clean up common stderr noise
        return chunk
          .replace(/^\s*\[.*?\]\s*/gm, '') // Remove log level prefixes
          .replace(/^\s*\d{4}-\d{2}-\d{2}.*?\s*/gm, '') // Remove timestamps
          .trim();
      }
    });
  }

  /**
   * Normalize stderr logs into error message entries
   */
  normalizeStderrLogs(
    stderrContent: string,
    indexProvider: EntryIndexProvider
  ): NormalizedEntry[] {
    const chunks = stderrContent.split(/\n\n+/); // Split on double newlines
    const entries: NormalizedEntry[] = [];

    for (const chunk of chunks) {
      if (chunk.trim()) {
        const processedEntries = this.processChunk(
          chunk + '\n',
          NormalizedEntryType.ERROR_MESSAGE,
          indexProvider
        );
        entries.push(...processedEntries);
      }
    }

    // Flush any remaining content
    const remainingEntries = this.flush(NormalizedEntryType.ERROR_MESSAGE, indexProvider);
    entries.push(...remainingEntries);

    return entries;
  }
}

/**
 * Simple implementation of EntryIndexProvider
 */
export class SimpleEntryIndexProvider implements IEntryIndexProvider {
  private currentIndex: number = 0;

  get_current_entry_index(): number {
    return this.currentIndex;
  }

  increment_entry_index(): void {
    this.currentIndex++;
  }

  reset(): void {
    this.currentIndex = 0;
  }
}

/**
 * Utility functions for log processing
 */
export class LogProcessorUtils {
  /**
   * Detect tool calls in log content
   */
  static detectToolCall(content: string): { toolName?: string; actionType?: string } {
    // Common patterns for tool calls
    const patterns = [
      /Tool:\s*(\w+)/i,
      /Using tool:\s*(\w+)/i,
      /\[(\w+)\]/,
      /<<<(\w+)>>>/,
      /@(\w+)/
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return { toolName: match[1].toLowerCase() };
      }
    }

    // Detect action types
    if (content.includes('reading file') || content.includes('file read')) {
      return { actionType: 'file_read' };
    }
    if (content.includes('editing file') || content.includes('file edit')) {
      return { actionType: 'file_edit' };
    }
    if (content.includes('running command') || content.includes('executing')) {
      return { actionType: 'command_run' };
    }

    return {};
  }

  /**
   * Clean up executor output for better readability
   */
  static cleanExecutorOutput(output: string): string {
    return output
      // Remove ANSI escape codes
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      // Remove excessive whitespace
      .replace(/\n{3,}/g, '\n\n')
      // Clean up common noise
      .replace(/^\s*[>|\-|#|\*]\s*/gm, '')
      .trim();
  }

  /**
   * Extract thinking sections from output
   */
  static extractThinking(content: string): { thinking?: string; content: string } {
    const thinkingPatterns = [
      /<thinking>(.*?)<\/thinking>/gs,
      /\[thinking\](.*?)\[\/thinking\]/gs,
      /\*\*Thinking:\*\*(.*?)(?=\n\n|\*\*|\Z)/gs
    ];

    for (const pattern of thinkingPatterns) {
      const match = content.match(pattern);
      if (match) {
        const thinking = match[1].trim();
        const cleanedContent = content.replace(pattern, '').trim();
        return { thinking, content: cleanedContent };
      }
    }

    return { content };
  }
}
