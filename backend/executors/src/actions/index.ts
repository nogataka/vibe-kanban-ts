export { CodingAgentInitialRequest } from './coding-agent-initial';
export { CodingAgentFollowUpRequest } from './coding-agent-follow-up';
export { ScriptRequest } from './script';
export * from './base';

import { CodingAgentInitialRequest } from './coding-agent-initial';
import { CodingAgentFollowUpRequest } from './coding-agent-follow-up';
import { ScriptRequest } from './script';
import { ExecutorAction, ExecutorActionType } from './base';

export class ActionFactory {
  static createInitialRequest(
    prompt: string,
    profileVariantLabel: { profile: string; variant?: string }
  ): CodingAgentInitialRequest {
    return new CodingAgentInitialRequest(prompt, profileVariantLabel);
  }

  static createFollowUpRequest(
    prompt: string,
    sessionId: string,
    profileVariantLabel: { profile: string; variant?: string }
  ): CodingAgentFollowUpRequest {
    return new CodingAgentFollowUpRequest(prompt, sessionId, profileVariantLabel);
  }

  static createScriptRequest(
    script: string,
    language: import('./base').ScriptRequestLanguage,
    context: import('./base').ScriptContext
  ): ScriptRequest {
    return new ScriptRequest(script, language, context);
  }
}

export class ActionExecutor {
  static async execute(action: ExecutorActionType, currentDir: string): Promise<import('./base').AsyncGroupChild> {
    return action.spawn(currentDir);
  }

  static async executeChain(action: ExecutorAction, currentDir: string): Promise<import('./base').AsyncGroupChild[]> {
    const results: import('./base').AsyncGroupChild[] = [];
    let currentAction: ExecutorAction | undefined = action;

    while (currentAction) {
      const result = await this.execute(currentAction.type, currentDir);
      results.push(result);
      currentAction = currentAction.nextAction;
    }

    return results;
  }
}
