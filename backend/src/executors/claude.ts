import { BaseExecutor, ExecutionContext, ExecutionResult, ExecutorConfig } from './base';
import { logger } from '../utils/logger';

export class ClaudeExecutor extends BaseExecutor {
  constructor(config: ExecutorConfig = {}) {
    super('claude', {
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      baseUrl: config.baseUrl || 'https://api.anthropic.com',
      model: config.model || 'claude-3-5-sonnet-20241022',
      maxTokens: config.maxTokens || 8192,
      temperature: config.temperature || 0.7,
      ...config
    });
  }

  async execute(
    prompt: string,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    try {
      await this.validateConfig();
      
      this.emitLog('info', 'Starting Claude execution', { 
        model: this.config.model,
        taskId: context.taskId 
      });
      
      this.emitProgress(10, 'Initializing Claude API');

      const systemPrompt = `You are a coding assistant working on a task in the directory: ${context.worktreePath}
Project root: ${context.projectPath}
Task ID: ${context.taskId}

You should:
1. Understand the task requirements
2. Implement the solution
3. Test your implementation
4. Provide clear documentation

Respond with your implementation and explanations.`;

      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey!,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${error}`);
      }

      this.emitProgress(50, 'Processing response');

      const data = await response.json() as any;
      const content = data.content[0].text;

      this.emitProgress(90, 'Execution complete');
      this.emitLog('info', 'Claude execution completed successfully');

      return {
        success: true,
        output: content
      };

    } catch (error: any) {
      logger.error('Claude executor error:', error);
      this.emitLog('error', 'Claude execution failed', { error: error.message });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}