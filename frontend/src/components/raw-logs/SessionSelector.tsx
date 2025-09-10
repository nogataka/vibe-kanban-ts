
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Clock, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';

interface SessionInfo {
  sessionId: string;
  messageCount?: number;
  lastModified?: Date;
  filePath: string;
}

interface SessionSelectorProps {
  sessions: string[];
  attemptDir: string;
  onSelectSession: (sessionId: string) => void;
}

export function SessionSelector({ 
  sessions, 
  attemptDir,
  onSelectSession 
}: SessionSelectorProps) {
  // Parse session IDs to extract info
  const sessionInfos: SessionInfo[] = sessions.map(sessionId => ({
    sessionId,
    filePath: `${attemptDir}/${sessionId}.jsonl`,
    // These would be populated with actual data from the API if available
    messageCount: undefined,
    lastModified: undefined
  }));

  const formatSessionTitle = (_sessionId: string, index: number) => {
    // If session ID matches a pattern, extract meaningful part
    // Otherwise, show a generic title
    return `Session ${index + 1}`;
  };

  const formatSessionId = (sessionId: string) => {
    // Show first 8 and last 8 characters with ellipsis
    if (sessionId.length > 20) {
      return `${sessionId.substring(0, 8)}...${sessionId.substring(sessionId.length - 8)}`;
    }
    return sessionId;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="text-lg font-semibold mb-4">
        Select a Claude Session
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sessionInfos.map((session, index) => (
          <Card 
            key={session.sessionId}
            className="cursor-pointer hover:shadow-lg transition-shadow hover:border-primary"
            onClick={() => onSelectSession(session.sessionId)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-semibold">
                    {formatSessionTitle(session.sessionId, index)}
                  </h3>
                </div>
              </div>
              
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="font-mono text-xs">
                  {formatSessionId(session.sessionId)}
                </div>
                
                {session.messageCount !== undefined && (
                  <div className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    <span>{session.messageCount} messages</span>
                  </div>
                )}
                
                {session.lastModified && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>Last modified: {format(session.lastModified, 'yyyy/M/d')}</span>
                  </div>
                )}
                
                <div className="text-xs text-muted-foreground/70 break-all">
                  {attemptDir.split('/').pop()}
                </div>
              </div>
              
              <Button 
                variant="secondary" 
                size="sm" 
                className="w-full mt-3"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSession(session.sessionId);
                }}
              >
                View Session
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      
      {sessions.length === 0 && (
        <Card className="p-8 text-center">
          <CardContent>
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              No Claude sessions found for this task attempt.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}