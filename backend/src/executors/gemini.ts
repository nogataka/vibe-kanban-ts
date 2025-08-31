import { BaseExecutor, ExecutionContext, ExecutionResult, ExecutorConfig } from './base';
import { logger } from '../utils/logger';

export class GeminiExecutor extends BaseExecutor {
  constructor(config: ExecutorConfig = {}) {
    super('gemini', {
      apiKey: config.apiKey || process.env.GOOGLE_API_KEY,
      baseUrl: config.baseUrl || 'https://generativelanguage.googleapis.com',
      model: config.model || 'gemini-1.5-pro-002',
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
      
      this.emitLog('info', 'Starting Gemini execution', { 
        model: this.config.model,
        taskId: context.taskId 
      });
      
      this.emitProgress(10, 'Initializing Gemini API');

      const systemPrompt = `You are a coding assistant working on a task in the directory: ${context.worktreePath}
Project root: ${context.projectPath}
Task ID: ${context.taskId}

You should:
1. Understand the task requirements
2. Implement the solution
3. Test your implementation
4. Provide clear documentation

Task: ${prompt}`;

      const response = await fetch(
        `${this.config.baseUrl}/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: systemPrompt
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: this.config.temperature,
              maxOutputTokens: this.config.maxTokens
            }
          })
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${error}`);
      }

      this.emitProgress(50, 'Processing response');

      const data = await response.json() as any;
      const content = data.candidates[0].content.parts[0].text;

      this.emitProgress(90, 'Execution complete');
      this.emitLog('info', 'Gemini execution completed successfully');

      return {
        success: true,
        output: content
      };

    } catch (error: any) {
      logger.error('Gemini executor error:', error);
      this.emitLog('error', 'Gemini execution failed', { error: error.message });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}