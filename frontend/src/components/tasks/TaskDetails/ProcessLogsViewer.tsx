import { useEffect, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { AlertCircle } from 'lucide-react';
import { useLogStream } from '@/hooks/useLogStream';
import RawLogText from '@/components/common/RawLogText';
import type { PatchType } from 'shared/types';

type LogEntry = Extract<PatchType, { type: 'STDOUT' } | { type: 'STDERR' }>;

interface ProcessLogsViewerProps {
  processId: string;
}

export default function ProcessLogsViewer({
  processId,
}: ProcessLogsViewerProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const didInitScroll = useRef(false);
  const prevLenRef = useRef(0);
  const [atBottom, setAtBottom] = useState(true);

  const { logs, error } = useLogStream(processId);

  // 1) Initial jump to bottom once data appears.
  useEffect(() => {
    if (!didInitScroll.current && logs.length > 0) {
      didInitScroll.current = true;
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: logs.length - 1,
          align: 'end',
        });
      });
    }
  }, [logs.length]);

  // 2) If there's a large append and we're at bottom, force-stick to the last item.
  useEffect(() => {
    const prev = prevLenRef.current;
    const grewBy = logs.length - prev;
    prevLenRef.current = logs.length;

    // tweak threshold as you like; this handles "big bursts"
    const LARGE_BURST = 10;
    if (grewBy >= LARGE_BURST && atBottom && logs.length > 0) {
      // defer so Virtuoso can re-measure before jumping
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: logs.length - 1,
          align: 'end',
        });
      });
    }
  }, [logs.length, atBottom, logs]);

  const formatLogLine = (entry: LogEntry, index: number) => {
    return (
      <RawLogText
        key={index}
        content={entry.content}
        channel={entry.type === 'STDERR' ? 'stderr' : 'stdout'}
        className="text-sm px-4 py-1"
      />
    );
  };

  return (
    <div className="h-full">
      {logs.length === 0 && !error ? (
        <div className="p-4 text-center text-muted-foreground text-sm">
          No logs available
        </div>
      ) : error ? (
        <div className="p-4 text-center text-destructive text-sm">
          <AlertCircle className="h-4 w-4 inline mr-2" />
          {error}
        </div>
      ) : (
        <Virtuoso<LogEntry>
          ref={virtuosoRef}
          className="flex-1 rounded-lg"
          data={logs}
          itemContent={(index, entry) =>
            formatLogLine(entry as LogEntry, index)
          }
          // Keep pinned while user is at bottom; release when they scroll up
          atBottomStateChange={setAtBottom}
          followOutput={atBottom ? 'smooth' : false}
          // Optional: a bit more overscan helps during bursts
          increaseViewportBy={{ top: 0, bottom: 600 }}
        />
      )}
    </div>
  );
}
