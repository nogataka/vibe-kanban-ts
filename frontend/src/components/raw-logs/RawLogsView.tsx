import { useEffect, useState } from 'react';
import { rawLogsApi, type ClaudeSessionData } from '@/lib/api/rawLogs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageItem } from './MessageItem';
import { SessionSelector } from './SessionSelector';

interface RawLogsViewProps {
  attemptId: string;
}

export function RawLogsView({ attemptId }: RawLogsViewProps) {
  const [sessionData, setSessionData] = useState<ClaudeSessionData | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);
  const [attemptDir, setAttemptDir] = useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');

  const fetchSessions = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await rawLogsApi.listSessions(attemptId);
      
      if (response.success && response.data) {
        setSessions(response.data.sessions);
        setAttemptDir(response.data.attemptDir);
        
        // If only one session, auto-select it
        if (response.data.sessions.length === 1) {
          handleSelectSession(response.data.sessions[0]);
        }
      } else {
        setError(response.error || 'Failed to load sessions');
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
      setError('Failed to fetch sessions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchRawLogs = async (sessionId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await rawLogsApi.getRawLogs(attemptId, sessionId);
      
      if (response.success && response.data) {
        setSessionData(response.data);
        setViewMode('detail');
      } else {
        setError(response.error || 'Failed to load raw logs');
      }
    } catch (err) {
      console.error('Error fetching raw logs:', err);
      setError('Failed to fetch raw logs. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    fetchRawLogs(sessionId);
  };

  const handleBackToSessions = () => {
    setViewMode('list');
    setSessionData(null);
    setSelectedSessionId(null);
  };

  useEffect(() => {
    fetchSessions();
  }, [attemptId]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button
              onClick={viewMode === 'list' ? fetchSessions : () => fetchRawLogs(selectedSessionId!)}
              variant="outline"
              size="sm"
              className="ml-4"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Session list view
  if (viewMode === 'list') {
    return (
      <SessionSelector
        sessions={sessions}
        attemptDir={attemptDir}
        onSelectSession={handleSelectSession}
      />
    );
  }

  // Session detail view
  if (!sessionData || sessionData.messages.length === 0) {
    return (
      <div className="p-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No messages found in this session.
          </AlertDescription>
        </Alert>
        <Button
          onClick={handleBackToSessions}
          variant="outline"
          size="sm"
          className="mt-4"
        >
          <ArrowLeft className="h-3 w-3 mr-1" />
          Back to Sessions
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {sessions.length > 1 && (
              <Button
                onClick={handleBackToSessions}
                variant="ghost"
                size="sm"
              >
                <ArrowLeft className="h-3 w-3 mr-1" />
                Sessions
              </Button>
            )}
            <div className="text-sm text-muted-foreground">
              Session: <span className="font-mono">{sessionData.sessionId}</span>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {sessionData.messages.length} messages
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <ul className="space-y-2 p-4">
          {sessionData.messages.map((message, index) => (
            <MessageItem
              key={`${message.role}-${index}`}
              message={message}
              index={index}
              allMessages={sessionData.messages}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}