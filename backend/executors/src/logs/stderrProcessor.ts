import { MsgStore, LogMsg } from '../../../utils/src/msgStore';
import { NormalizedEntry, NormalizedEntryType } from './types';
import { ConversationPatch } from './conversationPatch';
import { EntryIndexProvider } from './entryIndexProvider';

/**
 * Process stderr logs and convert them to normalized error entries
 * Matches Rust's normalize_stderr_logs implementation
 */
export function normalizeStderrLogs(
  msgStore: MsgStore,
  entryIndexProvider: EntryIndexProvider
): void {
  // Subscribe to stderr messages
  const unsubscribe = msgStore.subscribe((msg: LogMsg) => {
    if (msg.type === 'stderr' && msg.content) {
      // Create normalized error entry
      const entry: NormalizedEntry = {
        timestamp: null,
        entry_type: { type: 'error_message' } as NormalizedEntryType,
        content: msg.content,
        metadata: null
      };

      // Add to store with next index
      const id = entryIndexProvider.next();
      const patch = ConversationPatch.addNormalizedEntry(id, entry);
      msgStore.pushPatch(patch);
    }
  });

  // Process all existing stderr messages in history
  const history = msgStore.getHistory();
  for (const msg of history) {
    if (msg.type === 'stderr' && msg.content) {
      const entry: NormalizedEntry = {
        timestamp: null,
        entry_type: { type: 'error_message' } as NormalizedEntryType,
        content: msg.content,
        metadata: null
      };

      const id = entryIndexProvider.next();
      const patch = ConversationPatch.addNormalizedEntry(id, entry);
      msgStore.pushPatch(patch);
    }
  }

  // Clean up subscription after processing
  // Note: In the Rust version this runs in a spawned task,
  // but in Node.js we handle it synchronously for simplicity
  unsubscribe();
}