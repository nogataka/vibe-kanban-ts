import { BaseExecutor, ExecutionContext, ExecutionResult, ExecutorConfig } from './base';
import { logger } from '../utils/logger';

export class OpenAIExecutor extends BaseExecutor {
  constructor(config: ExecutorConfig = {}) {
    super('openai', {
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseUrl: config.baseUrl || 'https://api.openai.com',
      model: config.model || 'gpt-4o',
      maxTokens: config.maxTokens || 4096,
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
      
      this.emitLog('info', 'Starting OpenAI execution', { 
        model: this.config.model,
        taskId: context.taskId 
      });
      
      this.emitProgress(10, 'Initializing OpenAI API');

      const systemPrompt = `You are a coding assistant working on a task in the directory: ${context.worktreePath}
Project root: ${context.projectPath}
Task ID: ${context.taskId}

You should:
1. Understand the task requirements
2. Implement the solution
3. Test your implementation
4. Provide clear documentation

Respond with your implementation and explanations.`;

      const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      this.emitProgress(50, 'Processing response');

      const data = await response.json() as any;
      const content = data.choices[0].message.content;

      this.emitProgress(90, 'Execution complete');
      this.emitLog('info', 'OpenAI execution completed successfully');

      return {
        success: true,
        output: content
      };

    } catch (error: any) {
      logger.error('OpenAI executor error:', error);
      this.emitLog('error', 'OpenAI execution failed', { error: error.message });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}