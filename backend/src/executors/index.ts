import { BaseExecutor, ExecutorConfig } from './base';
import { ClaudeExecutor } from './claude';
import { OpenAIExecutor } from './openai';
import { GeminiExecutor } from './gemini';

export { BaseExecutor, ExecutorConfig, ExecutionContext, ExecutionResult } from './base';
export { ClaudeExecutor } from './claude';
export { OpenAIExecutor } from './openai';
export { GeminiExecutor } from './gemini';

export type ExecutorType = 
  | 'claude-3-5-sonnet-latest'
  | 'claude-3-5-haiku-latest'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'o1-preview'
  | 'o1-mini'
  | 'gemini-1-5-pro-002'
  | 'gemini-1-5-flash-002'
  | 'gemini-2-0-flash-exp'
  | 'deepseek-chat'
  | 'bedrock-claude-3-5-sonnet-v2'
  | 'bedrock-claude-3-5-haiku'
  | 'qwen-coder-plus-latest';

export class ExecutorFactory {
  static create(type: ExecutorType, config?: ExecutorConfig): BaseExecutor {
    switch (type) {
      case 'claude-3-5-sonnet-latest':
        return new ClaudeExecutor({
          ...config,
          model: 'claude-3-5-sonnet-20241022'
        });
      
      case 'claude-3-5-haiku-latest':
        return new ClaudeExecutor({
          ...config,
          model: 'claude-3-5-haiku-20241022'
        });
      
      case 'gpt-4o':
        return new OpenAIExecutor({
          ...config,
          model: 'gpt-4o'
        });
      
      case 'gpt-4o-mini':
        return new OpenAIExecutor({
          ...config,
          model: 'gpt-4o-mini'
        });
      
      case 'o1-preview':
        return new OpenAIExecutor({
          ...config,
          model: 'o1-preview'
        });
      
      case 'o1-mini':
        return new OpenAIExecutor({
          ...config,
          model: 'o1-mini'
        });
      
      case 'gemini-1-5-pro-002':
        return new GeminiExecutor({
          ...config,
          model: 'gemini-1.5-pro-002'
        });
      
      case 'gemini-1-5-flash-002':
        return new GeminiExecutor({
          ...config,
          model: 'gemini-1.5-flash-002'
        });
      
      case 'gemini-2-0-flash-exp':
        return new GeminiExecutor({
          ...config,
          model: 'gemini-2.0-flash-exp'
        });
      
      default:
        throw new Error(`Unsupported executor type: ${type}`);
    }
  }

  static getAvailableExecutors(): ExecutorType[] {
    return [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'gpt-4o',
      'gpt-4o-mini',
      'o1-preview',
      'o1-mini',
      'gemini-1-5-pro-002',
      'gemini-1-5-flash-002',
      'gemini-2-0-flash-exp',
      'deepseek-chat',
      'bedrock-claude-3-5-sonnet-v2',
      'bedrock-claude-3-5-haiku',
      'qwen-coder-plus-latest'
    ];
  }
}