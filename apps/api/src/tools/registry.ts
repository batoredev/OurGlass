/**
 * The tool registry — a name -> ToolDefinition lookup.
 *
 * Deliberately dumb: no dynamic loading, no plugin discovery. Tools are
 * registered explicitly in ./index.ts. Kept separate from executor.ts so the
 * executor can be unit-tested against a registry of fakes without pulling in
 * every real tool.
 *
 * docs/PHASE-1-DESIGN.md §4.1/§4.2.
 */
import type { ToolDefinition } from "@ourglass/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): readonly AnyToolDefinition[] {
    return [...this.tools.values()];
  }
}
