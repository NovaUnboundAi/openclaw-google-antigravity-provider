// Workspace bootstrap delivery for agy conversations.
//
// openclaw only resolves workspace bootstrap files when the backend can
// transport a system prompt:
//
//   bootstrapRouting = skipsTurnPreparation || !canTransportSystemPrompt(cfg)
//     ? void 0 : await resolveWorkspaceBootstrapRouting({...})
//
// and canTransportSystemPrompt requires one of systemPromptArg,
// systemPromptFileArg or systemPromptFileConfigKey. agy has no system-prompt
// flag to point any of them at, and it does not read an AGENTS.md from the
// working directory on its own. Left alone, an agy turn therefore runs on agy's
// built-in agent prompt and ignores the workspace instructions that give an
// openclaw agent its behaviour on every other provider.
//
// So this module reads the same files openclaw would and hands them to agy in
// the prompt. The filenames mirror openclaw's WORKSPACE_BOOTSTRAP_FILENAMES,
// in its order.

import fsp from "node:fs/promises";
import path from "node:path";

export const WORKSPACE_BOOTSTRAP_FILENAMES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
] as const;

// The block travels inside the prompt argument, so it competes with the OS
// argv ceiling. openclaw's own reseed can already spend ~12,199 chars on the
// same turn, and Windows caps the whole command line near 32,767.
export const DEFAULT_WORKSPACE_CONTEXT_MAX_CHARS = 16_000;
export const WINDOWS_WORKSPACE_CONTEXT_MAX_CHARS = 6_000;

export function defaultWorkspaceContextMaxChars(
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === "win32"
    ? WINDOWS_WORKSPACE_CONTEXT_MAX_CHARS
    : DEFAULT_WORKSPACE_CONTEXT_MAX_CHARS;
}

export type WorkspaceBootstrapFile = {
  readonly name: string;
  readonly content: string;
};

export type ReadFile = (filePath: string) => Promise<string>;

const defaultReadFile: ReadFile = (filePath) => fsp.readFile(filePath, "utf8");

// Missing files are the normal case — every one of these is optional — so a
// read failure is skipped rather than surfaced.
export async function readWorkspaceBootstrapFiles(
  workspaceDir: string,
  readFile: ReadFile = defaultReadFile,
): Promise<WorkspaceBootstrapFile[]> {
  const out: WorkspaceBootstrapFile[] = [];
  for (const name of WORKSPACE_BOOTSTRAP_FILENAMES) {
    let raw: string;
    try {
      raw = await readFile(path.join(workspaceDir, name));
    } catch {
      continue;
    }
    const content = typeof raw === "string" ? raw.trim() : "";
    if (content) out.push({ name, content });
  }
  return out;
}

export type BuildWorkspaceContextParams = {
  readonly workspaceDir: string;
  readonly agentId?: string;
  readonly files: readonly WorkspaceBootstrapFile[];
  readonly maxChars?: number;
};

// Renders the block agy receives. Returns undefined when the workspace has no
// instructions worth sending.
export function buildWorkspaceContextBlock(
  params: BuildWorkspaceContextParams,
): string | undefined {
  if (params.files.length === 0) return undefined;
  const maxChars = params.maxChars ?? defaultWorkspaceContextMaxChars();

  // Earlier files win: openclaw's ordering puts the operating instructions
  // (AGENTS.md) ahead of persona, and MEMORY.md last, so truncation drops the
  // most incidental content first.
  const sections: string[] = [];
  let used = 0;
  const omitted: string[] = [];
  for (const file of params.files) {
    const header = `--- ${file.name} ---`;
    const candidate = `${header}\n${file.content}`;
    if (used + candidate.length <= maxChars) {
      sections.push(candidate);
      used += candidate.length + 2;
      continue;
    }
    const remaining = maxChars - used - header.length - 2;
    // Only bother truncating when a useful amount of the file survives.
    if (remaining > 200) {
      sections.push(
        `${header}\n${file.content.slice(0, remaining).trimEnd()}\n[truncated]`,
      );
      used = maxChars;
      continue;
    }
    omitted.push(file.name);
  }
  if (sections.length === 0) return undefined;

  const agent = params.agentId?.trim();
  return [
    `These are the OpenClaw workspace instructions for${agent ? ` agent "${agent}"` : " this agent"}.`,
    "They define how you are expected to behave here and take precedence over your own default persona.",
    `Workspace: ${params.workspaceDir}`,
    ...(omitted.length > 0
      ? [`[Omitted to stay within budget: ${omitted.join(", ")}.]`]
      : []),
    "",
    "<workspace_instructions>",
    sections.join("\n\n"),
    "</workspace_instructions>",
  ].join("\n");
}

// Tracks which agy conversation already received the workspace block, so it is
// sent once per conversation rather than every turn.
//
// Keyed per agent *and* workspace: openclaw is multi-agent, each agent resolves
// its own workspace directory, and two agents in one gateway must not consume
// each other's delivery state.
export class WorkspaceContextDeliveryTracker {
  private readonly delivered = new Map<string, string>();
  private readonly pending = new Set<string>();

  static key(agentId: string | undefined, workspaceDir: string): string {
    return `${agentId?.trim() || "-"}::${workspaceDir}`;
  }

  // `conversationId` is the agy conversation currently bound to this
  // workspace, or undefined when none exists yet.
  shouldSend(
    agentId: string | undefined,
    workspaceDir: string,
    conversationId: string | undefined,
  ): boolean {
    const key = WorkspaceContextDeliveryTracker.key(agentId, workspaceDir);
    if (!conversationId) {
      // No conversation yet: this turn creates one, and it needs the block.
      this.pending.add(key);
      return true;
    }
    if (this.pending.has(key)) {
      // The previous turn sent the block and this is the conversation it
      // created, so it is already carried in that conversation's history.
      this.pending.delete(key);
      this.delivered.set(key, conversationId);
      return false;
    }
    if (this.delivered.get(key) === conversationId) return false;
    // A different conversation id means the binding was lost or replaced, and
    // the new conversation has never seen the instructions.
    this.delivered.set(key, conversationId);
    return true;
  }

  reset(): void {
    this.delivered.clear();
    this.pending.clear();
  }
}
