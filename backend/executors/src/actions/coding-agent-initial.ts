import { ExecutableAction, ProfileVariantLabel, AsyncGroupChild } from './base';
import { CodingAgent } from '../executors/mod';

export class CodingAgentInitialRequest implements ExecutableAction {
  public readonly type = 'CodingAgentInitialRequest' as const;
  
  constructor(
    public readonly prompt: string,
    public readonly profile_variant_label: ProfileVariantLabel
  ) {}

  async spawn(currentDir: string): Promise<AsyncGroupChild> {
    const agent = CodingAgent.fromProfileVariantLabel(this.profile_variant_label);
    return await agent.spawn(currentDir, this.prompt);
  }
}
