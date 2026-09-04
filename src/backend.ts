import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type {
  CliBackendConfig,
  CliBackendNormalizeConfigContext,
  CliBackendPlugin,
  CliBackendResolveExecutionArgsContext,
} from "openclaw/plugin-sdk/cli-backend";
import { DEFAULT_PRINT_TIMEOUT, formatGoDuration } from "./config.js";

export const GOOGLE_ANTIGRAVITY_PROVIDER_ID = "google-antigravity-cli";
export const GOOGLE_ANTIGRAVITY_DEFAULT_MODEL_REF =
  "google-antigravity-cli/gemini-3.7-flash";

export const GOOGLE_ANTIGRAVITY_MODEL_ALIASES: Record<string, string> = {
  // Human shortcuts collapse to the base family; the effort slider
  // supplies the level at execution time.
  flash: "gemini-3.7-flash",
  "flash-high": "gemini-3.7-flash",
  "flash-medium": "gemini-3.7-flash",
  "flash-low": "gemini-3.7-flash",
  pro: "gemini-3.1-pro",
  "pro-low": "gemini-3.1-pro",
  "pro-high": "gemini-3.1-pro",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6-thinking",
  gpt: "gpt-oss-120b-medium",
  // Base identity aliases (canonical).
  "gemini-3.8-flash": "gemini-3.8-flash",
  "gemini-3.7-flash": "gemini-3.7-flash",
  "gemini-3.6-flash": "gemini-3.6-flash",
  "gemini-3.1-pro": "gemini-3.1-pro",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-opus-4-6-thinking": "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium": "gpt-oss-120b-medium",
  // Effort-baked identity aliases kept for existing configs: agy still
  // accepts them, and the ID already carries the effort so nothing extra
  // needs to be injected.
  "gemini-3.8-flash-high": "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium": "gemini-3.8-flash-medium",
  "gemini-3.8-flash-low": "gemini-3.8-flash-low",
  "gemini-3.7-flash-high": "gemini-3.7-flash-high",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-medium",
  "gemini-3.7-flash-low": "gemini-3.7-flash-low",
  "gemini-3.6-flash-high": "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium": "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low": "gemini-3.6-flash-low",
  "gemini-3.1-pro-low": "gemini-3.1-pro-low",
  "gemini-3.1-pro-high": "gemini-3.1-pro-high",
  // Legacy dotted aliases from earlier README examples.
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-opus-4.6": "claude-opus-4-6-thinking",
  "gpt-oss-120b": "gpt-oss-120b-medium",
};

// Openclaw exposes eight canonical thinking levels; agy accepts three.
// `off`/`minimal`/`low` → `low`, `medium`/`adaptive` → `medium`,
// `high`/`xhigh`/`max` → `high`. An unrecognized or missing level returns
// `undefined`, in which case we don't inject `--effort` at all and agy
// uses its own default for the selected model.
export function mapThinkingLevelToAgyEffort(
  level?: string,
): "low" | "medium" | "high" | undefined {
  switch (level) {
    case "off":
    case "minimal":
    case "low":
      return "low";
    case "medium":
    case "adaptive":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return "high";
    default:
      return undefined;
  }
}

// Effort-baked model IDs (e.g. `gemini-3.7-flash-high`) already carry the
// level via the ID itself; injecting `--effort` on top is redundant. Keep
// the injection behavior strictly opt-in per model.
function modelIdHasBakedEffort(modelId: string): boolean {
  if (!modelId.startsWith("gemini-")) return false;
  return /-(?:high|medium|low)$/.test(modelId);
}

const CONVERSATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function resolveHomeDir(env: NodeJS.ProcessEnv): string {
  return normalizeOptionalString(env.HOME) ?? os.homedir();
}

export function resolveAntigravityDataDir(env: NodeJS.ProcessEnv): string {
  const homeDir = resolveHomeDir(env);
  const configured = normalizeOptionalString(env.ANTIGRAVITY_USER_DATA_DIR);
  if (!configured) return path.join(homeDir, ".gemini", "antigravity-cli");
  if (configured === "~") return homeDir;
  if (configured.startsWith("~/")) return path.join(homeDir, configured.slice(2));
  return path.resolve(configured);
}

export async function readConversationCache(
  cachePath: string,
): Promise<Record<string, string> | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(cachePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Antigravity conversation cache is not a JSON object: ${cachePath}`);
  }
  return parsed as Record<string, string>;
}

export async function resolveCachedConversationId(params: {
  cachePath: string;
  cwd: string;
}): Promise<string | undefined> {
  const cache = await readConversationCache(params.cachePath);
  if (!cache) return undefined;
  const cwdCandidates = new Set<string>([params.cwd, path.resolve(params.cwd)]);
  try {
    cwdCandidates.add(await fs.realpath(params.cwd));
  } catch {}
  for (const cwd of cwdCandidates) {
    const value = cache[cwd];
    if (typeof value === "string" && CONVERSATION_ID_PATTERN.test(value.trim())) {
      return value.trim();
    }
  }
  return undefined;
}

function resolvePluginConfig(
  cfg?: Record<string, any>,
  providerId?: string,
): Record<string, any> | undefined {
  return (
    cfg?.plugins?.entries?.[providerId ?? GOOGLE_ANTIGRAVITY_PROVIDER_ID]?.config ??
    cfg?.plugins?.entries?.[GOOGLE_ANTIGRAVITY_PROVIDER_ID]?.config
  );
}

export type ParsedCliBackendEvent =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "toolStart";
      toolCallId: string;
      name: string;
      args?: Record<string, unknown>;
    }
  | {
      kind: "toolResult";
      toolCallId: string;
      name?: string;
      isError?: boolean;
      result?: unknown;
    }
  | {
      kind: "result";
      text?: string;
      sessionId?: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        total?: number;
      };
      errorText?: string;
    }
  | { kind: "sessionId"; sessionId: string };

export function parseGoogleAntigravityJsonlEvent(
  line: string,
  _ctx?: { backendId: string; backend: Readonly<CliBackendConfig> },
): ParsedCliBackendEvent | readonly ParsedCliBackendEvent[] | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return null;
  }

  let record: any;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!record || typeof record !== "object") {
    return null;
  }

  const events: ParsedCliBackendEvent[] = [];

  // 1. Session initialization
  if (record.event === "init" && typeof record.conversation_id === "string") {
    events.push({ kind: "sessionId", sessionId: record.conversation_id });
  }

  // 2. Incremental step updates (thinking, text, and tools)
  if (record.event === "step_update" && record.step_update) {
    const step = record.step_update;

    // Reasoning / thinking deltas
    const thoughtDelta =
      step.thought_delta ??
      step.thinking_delta ??
      step.reasoning_delta ??
      (step.step_type === "thinking" ? (step.delta ?? step.text) : undefined);
    if (typeof thoughtDelta === "string" && thoughtDelta.length > 0) {
      events.push({ kind: "thinking", text: thoughtDelta });
    }

    // Response text deltas
    const textDelta =
      step.text_delta ??
      (step.step_type === "agent_response" ? (step.delta ?? step.text_delta) : undefined);
    if (typeof textDelta === "string" && textDelta.length > 0) {
      events.push({ kind: "text", text: textDelta });
    }

    // Tool execution lifecycle
    if (step.step_type === "tool") {
      const toolCallId = `call_${step.step_index ?? Date.now()}`;
      const toolName = step.tool_name ?? step.tool_info?.name ?? "tool";

      if (step.state === "ACTIVE") {
        events.push({
          kind: "toolStart",
          toolCallId,
          name: toolName,
          args: step.tool_info?.parameters,
        });
      } else if (step.state === "DONE" || step.state === "ERROR") {
        events.push({
          kind: "toolResult",
          toolCallId,
          name: toolName,
          isError: step.state === "ERROR",
          result: step.tool_info?.output ?? step.output,
        });
      }
    }
  }

  // 3. Terminal result or execution failure
  if (record.event === "result" && record.result) {
    const res = record.result;
    const usage = res.usage
      ? {
          input: typeof res.usage.input_tokens === "number" ? res.usage.input_tokens : undefined,
          output: typeof res.usage.output_tokens === "number" ? res.usage.output_tokens : undefined,
          cacheRead:
            typeof res.usage.cache_read_tokens === "number"
              ? res.usage.cache_read_tokens
              : undefined,
          total: typeof res.usage.total_tokens === "number" ? res.usage.total_tokens : undefined,
        }
      : undefined;

    if (res.status === "ERROR" || res.status === "FAILED") {
      if (typeof res.response === "string" && res.response.trim().length > 0) {
        events.push({
          kind: "result",
          text: res.response,
          sessionId: typeof res.conversation_id === "string" ? res.conversation_id : undefined,
          usage,
        });
      } else {
        events.push({
          kind: "result",
          errorText: res.error || res.message || "Antigravity CLI execution error",
        });
      }
    } else {
      events.push({
        kind: "result",
        text:
          typeof res.response === "string" ? res.response : "",
        sessionId: typeof res.conversation_id === "string" ? res.conversation_id : undefined,
        usage,
      });
    }
  }

  if (events.length === 0) {
    return typeof record.event === "string" ? [] : null;
  }
  if (events.length === 1) return events[0];
  return events;
}

export function normalizeGoogleAntigravityBackendConfig(
  config: CliBackendConfig,
  context?: CliBackendNormalizeConfigContext,
): CliBackendConfig {
  const cfg = context?.config as Record<string, any> | undefined;
  const pluginConfig = resolvePluginConfig(cfg, context?.backendId);
  const backendConfig =
    (context?.backendId ? cfg?.agents?.defaults?.cliBackends?.[context.backendId] : undefined) ??
    cfg?.agents?.defaults?.cliBackends?.[GOOGLE_ANTIGRAVITY_PROVIDER_ID] ??
    pluginConfig;

  const streamEnabled =
    backendConfig?.stream === true ||
    backendConfig?.streaming === true ||
    backendConfig?.output === "jsonl" ||
    backendConfig?.outputFormat === "stream-json" ||
    pluginConfig?.stream === true ||
    pluginConfig?.streaming === true;

  if (streamEnabled) {
    return {
      ...config,
      output: "jsonl",
      resumeOutput: "jsonl",
    };
  }

  return config;
}

export function resolveGoogleAntigravityExecutionArgs(
  context: CliBackendResolveExecutionArgsContext,
): string[] {
  const cfg = context.config as Record<string, any> | undefined;
  const providerId = context.provider || GOOGLE_ANTIGRAVITY_PROVIDER_ID;
  const pluginConfig = resolvePluginConfig(cfg, providerId);
  const backendConfig =
    cfg?.agents?.defaults?.cliBackends?.[providerId] ??
    cfg?.agents?.defaults?.cliBackends?.[GOOGLE_ANTIGRAVITY_PROVIDER_ID] ??
    pluginConfig;

  const configuredTimeout =
    backendConfig?.printTimeout ??
    pluginConfig?.printTimeout ??
    cfg?.agents?.defaults?.models?.[context.modelId]?.params?.timeoutSeconds ??
    cfg?.agents?.defaults?.models?.[`${providerId}/*`]?.params?.timeoutSeconds ??
    cfg?.agents?.defaults?.models?.[`${GOOGLE_ANTIGRAVITY_PROVIDER_ID}/*`]?.params?.timeoutSeconds ??
    cfg?.agents?.defaults?.timeoutSeconds;

  const timeoutStr = formatGoDuration(configuredTimeout, DEFAULT_PRINT_TIMEOUT);
  const args = [...context.baseArgs];
  const timeoutIndex = args.indexOf("--print-timeout");

  if (timeoutIndex !== -1 && timeoutIndex + 1 < args.length) {
    args[timeoutIndex + 1] = timeoutStr;
  } else {
    args.push("--print-timeout", timeoutStr);
  }

  // Streaming/JSONL mode is enabled by default to capture conversation IDs and live deltas
  const streamDisabled =
    backendConfig?.stream === false ||
    backendConfig?.streaming === false ||
    pluginConfig?.stream === false ||
    pluginConfig?.streaming === false ||
    backendConfig?.output === "text" ||
    backendConfig?.outputFormat === "text";

  if (!streamDisabled && !args.includes("--output-format")) {
    args.push("--output-format", "stream-json");
  }

  // Wire openclaw's thinking-level slider into agy's `--effort` flag when
  // the selected model doesn't already bake the level into its ID. `agy`
  // is happy to accept both `--model <family>` + `--effort <level>` and
  // the older `--model <family>-<level>` shape; we prefer the former so
  // the slider stays authoritative for base-ID rows.
  const rawModelId = context.modelId?.trim() ?? "";
  const modelIdWithoutProvider = rawModelId.includes("/")
    ? rawModelId.slice(rawModelId.lastIndexOf("/") + 1)
    : rawModelId;
  const effort = mapThinkingLevelToAgyEffort(context.thinkingLevel);
  if (
    effort &&
    !args.includes("--effort") &&
    !modelIdHasBakedEffort(modelIdWithoutProvider)
  ) {
    args.push("--effort", effort);
  }

  return args;
}

export function buildGoogleAntigravityCliBackend(
  backendId = GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  env: NodeJS.ProcessEnv = process.env,
): CliBackendPlugin {
  const userDataDir = resolveAntigravityDataDir(env);
  const conversationCachePath = path.join(userDataDir, "cache", "last_conversations.json");

  const backend: CliBackendPlugin = {
    id: backendId,
    modelProvider: backendId,
    liveTest: { defaultModelRef: `${backendId}/gemini-3.7-flash` },
    nativeToolMode: "always-on",
    ownsNativeCompaction: true,
    normalizeConfig: normalizeGoogleAntigravityBackendConfig,
    resolveExecutionArgs: resolveGoogleAntigravityExecutionArgs,
    prepareExecution: (ctx) => {
      const cwd = (ctx as { cwd?: string; workspaceDir: string }).cwd ?? ctx.workspaceDir;
      let priorConversationId: string | undefined;
      let stagedAtMs = 0;

      return {
        ...(normalizeOptionalString(env.ANTIGRAVITY_USER_DATA_DIR)
          ? { env: { ANTIGRAVITY_USER_DATA_DIR: userDataDir } }
          : {}),
        clearEnv: [
          "GEMINI_API_KEY",
          "GOOGLE_API_KEY",
          "GOOGLE_APPLICATION_CREDENTIALS",
          "GOOGLE_CLOUD_PROJECT",
          "GOOGLE_CLOUD_PROJECT_ID",
        ],
        beforeExecution: async () => {
          priorConversationId = await resolveCachedConversationId({
            cachePath: conversationCachePath,
            cwd,
          });
          stagedAtMs = Date.now();
        },
        captureSessionId: async (captureCtx: { cwd: string; executionMode?: string }) => {
          if (captureCtx.executionMode === "side-question") return;
          const conversationId = await resolveCachedConversationId({
            cachePath: conversationCachePath,
            cwd: captureCtx.cwd,
          });
          if (!conversationId) {
            throw new Error(`Antigravity did not publish a conversation id for ${captureCtx.cwd}`);
          }
          if (conversationId === priorConversationId) {
            throw new Error(`Antigravity did not create a new conversation for ${captureCtx.cwd}`);
          }
          const conversationPath = path.join(
            userDataDir,
            "conversations",
            `${conversationId}.db`,
          );
          let conversationStat;
          try {
            conversationStat = await fs.stat(conversationPath);
          } catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") {
              throw new Error(
                `Antigravity conversation ${conversationId} has no SQLite state`,
                { cause: error },
              );
            }
            throw error;
          }
          if (
            !conversationStat.isFile() ||
            (stagedAtMs > 0 && conversationStat.mtimeMs < stagedAtMs - 2000)
          ) {
            throw new Error(`Antigravity conversation ${conversationId} is not current`);
          }
          return conversationId;
        },
      } as any;
    },
    config: {
      command: "agy",
      args: [
        "--print",
        "{prompt}",
        "--print-timeout",
        DEFAULT_PRINT_TIMEOUT,
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
      ],
      resumeArgs: [
        "--conversation",
        "{sessionId}",
        "--print",
        "{prompt}",
        "--print-timeout",
        DEFAULT_PRINT_TIMEOUT,
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
      ],
      output: "jsonl",
      input: "arg",
      // agy exposes no image flag and its stream-json input rejects non-text
      // content blocks, so openclaw stages images and appends their paths to
      // the prompt (the `imageArg`-unset path in its CLI runner). Staging into
      // the workspace keeps them inside the directory agy is allowed to open
      // with `view_file`; the "temp" scope would land outside it.
      imagePathScope: "workspace",
      modelArg: "--model",
      modelAliases: GOOGLE_ANTIGRAVITY_MODEL_ALIASES,
      systemPromptWhen: "first",
      sessionMode: "existing",
      serialize: true,
    },
  };

  (backend as any).parseJsonlEvent = parseGoogleAntigravityJsonlEvent;
  (backend as any).manualCompaction = {
    buildPrompt: (customInstructions?: string): string => {
      const instructions = customInstructions?.trim();
      const customPart = instructions ? ` Focus on: ${instructions}` : "";
      return `Do not execute any tools or commands. Provide a concise summary and compaction of this conversation so far, preserving key decisions, active context, and current progress.${customPart}`;
    },
    input: "arg",
    validateOutput: (rawOutput: string): { ok: boolean; reason?: string } => {
      const trimmed = rawOutput.trim();
      if (!trimmed) {
        return {
          ok: false,
          reason: "Antigravity CLI returned empty output during compaction.",
        };
      }
      if (
        trimmed.includes("not found") &&
        (trimmed.includes("conversation") || trimmed.includes("warning: conversation"))
      ) {
        return {
          ok: false,
          reason:
            "Antigravity native conversation not found for this session. Send a message first to establish the conversation before compacting.",
        };
      }
      for (const line of trimmed.split("\n")) {
        const lineTrimmed = line.trim();
        if (!lineTrimmed.startsWith("{")) continue;
        try {
          const record = JSON.parse(lineTrimmed);
          if (record.event === "result" && record.result) {
            if (record.result.status === "ERROR" || record.result.status === "FAILED") {
              const err =
                record.result.error ||
                record.result.message ||
                "Antigravity compaction error";
              if (
                err.toLowerCase().includes("context canceled") ||
                err.toLowerCase().includes("not found")
              ) {
                return {
                  ok: false,
                  reason:
                    "Antigravity native conversation not found or canceled. Send a message first to initialize the native conversation before compacting.",
                };
              }
              return {
                ok: false,
                reason: err,
              };
            }
            return { ok: true };
          }
        } catch {}
      }
      return { ok: true };
    },
  };

  return backend;
}
