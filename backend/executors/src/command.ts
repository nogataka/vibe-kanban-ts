/**
 * Command builder for constructing executor commands
 * Equivalent to Rust's CommandBuilder
 */
export class CommandBuilder {
  constructor(
    private base: string,
    private parameters?: string[]
  ) {}

  /**
   * Build initial command (matches Rust CommandBuilder::build_initial)
   */
  buildInitial(): string {
    const parts = [this.base];
    if (this.parameters) {
      parts.push(...this.parameters);
    }
    return parts.join(' ');
  }

  /**
   * Build follow-up command with additional args (matches Rust CommandBuilder::build_follow_up)
   */
  buildFollowUp(additionalArgs: string[]): string {
    const parts = [this.base];
    if (this.parameters) {
      parts.push(...this.parameters);
    }
    parts.push(...additionalArgs);
    return parts.join(' ');
  }

  /**
   * Create new CommandBuilder with parameters
   */
  static new(base: string): CommandBuilder {
    return new CommandBuilder(base);
  }

  /**
   * Add parameters to the command
   */
  params(params: string[]): CommandBuilder {
    return new CommandBuilder(this.base, params);
  }
}
