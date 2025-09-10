import { makeRequest, handleApiResponse } from '../api';

export interface ClaudeToolUse {
  id: string;
  name: string;
  input: any;
}

export interface ClaudeToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  tool_use?: ClaudeToolUse;
  tool_result?: ClaudeToolResult;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ClaudeContentBlock[];
  timestamp?: string;
  type?: string;
}

export interface ClaudeSessionData {
  messages: ClaudeMessage[];
  sessionId: string;
  worktreePath: string;
  filePath: string;
}

export interface RawLogsResponse {
  success: boolean;
  data: ClaudeSessionData | null;
  error: string | null;
}

export interface SessionListResponse {
  success: boolean;
  data: {
    sessions: string[];
    attemptId: string;
    attemptDir: string;
  } | null;
  error: string | null;
}

export const rawLogsApi = {
  /**
   * Get raw Claude session logs for a task attempt
   */
  async getRawLogs(attemptId: string, sessionId?: string): Promise<RawLogsResponse> {
    const params = sessionId ? `?sessionId=${sessionId}` : '';
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/raw-logs${params}`
    );
    const data = await handleApiResponse<ClaudeSessionData | null>(response);
    return {
      success: true,
      data,
      error: null
    };
  },

  /**
   * List available Claude sessions for a task attempt
   */
  async listSessions(attemptId: string): Promise<SessionListResponse> {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/sessions`
    );
    const data = await handleApiResponse<{
      sessions: string[];
      attemptId: string;
      attemptDir: string;
    } | null>(response);
    return {
      success: true,
      data,
      error: null
    };
  }
};