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
  "google-antigravity-cli/gemini-3.7-flash-medium";

export const GOOGLE_ANTIGRAVITY_MODEL_ALIASES: Record<string, string> = {
  flash: "gemini-3.7-flash-medium",
  "flash-high": "gemini-3.7-flash-high",
  "flash-medium": "gemini-3.7-flash-medium",
  "flash-low": "gemini-3.7-flash-low",
  pro: "gemini-3.1-pro-high",
  "pro-low": "gemini-3.1-pro-low",
  "pro-high": "gemini-3.1-pro-high",
  sonnet: "claude-sonnet-4.6",
  opus: "claude-opus-4.6",
  gpt: "gpt-oss-120b",
  "gemini-3.7-flash-high": "gemini-3.7-flash-high",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-medium",
  "gemini-3.7-flash-low": "gemini-3.7-flash-low",
  "gemini-3.6-flash-high": "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium": "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low": "gemini-3.6-flash-low",
  "gemini-3.5-flash": "gemini-3.5-flash-medium",
  "gemini-3.5-flash-medium": "gemini-3.5-flash-medium",
  "gemini-3.5-flash-high": "gemini-3.5-flash-high",
  "gemini-3.5-flash-low": "gemini-3.5-flash-low",
  "gemini-3.1-pro-low": "gemini-3.1-pro-low",
  "gemini-3.1-pro-high": "gemini-3.1-pro-high",
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-opus-4.6": "claude-opus-4-6-thinking",
  "gpt-oss-120b": "gpt-oss-120b-medium",
};

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

export function normalizeGoogleAntigravityBackendConfig(
  config: CliBackendConfig,
  context?: CliBackendNormalizeConfigContext,
): CliBackendConfig {
  const cfg = context?.config as Record<string, any> | undefined;
  const backendConfig =
    (context?.backendId ? cfg?.agents?.defaults?.cliBackends?.[context.backendId] : undefined) ??
    cfg?.agents?.defaults?.cliBackends?.[GOOGLE_ANTIGRAVITY_PROVIDER_ID];

  const streamEnabled =
    backendConfig?.stream === true ||
    backendConfig?.streaming === true ||
    backendConfig?.output === "jsonl" ||
    backendConfig?.outputFormat === "stream-json";

  if (streamEnabled) {
    return {
      ...config,
      output: "jsonl",
    };
  }

  return config;
}

export function resolveGoogleAntigravityExecutionArgs(
  context: CliBackendResolveExecutionArgsContext,
): string[] {
  const cfg = context.config as Record<string, any> | undefined;
  const providerId = context.provider || GOOGLE_ANTIGRAVITY_PROVIDER_ID;
  const backendConfig =
    cfg?.agents?.defaults?.cliBackends?.[providerId] ??
    cfg?.agents?.defaults?.cliBackends?.[GOOGLE_ANTIGRAVITY_PROVIDER_ID];

  const configuredTimeout =
    backendConfig?.printTimeout ??
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

  // Optional streaming mode via config
  const streamEnabled =
    backendConfig?.stream === true ||
    backendConfig?.streaming === true ||
    backendConfig?.output === "jsonl" ||
    backendConfig?.outputFormat === "stream-json";

  if (streamEnabled && !args.includes("--output-format")) {
    args.push("--output-format", "stream-json");
  }

  return args;
}

export function buildGoogleAntigravityCliBackend(
  backendId = GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  env: NodeJS.ProcessEnv = process.env,
): CliBackendPlugin {
  const userDataDir = resolveAntigravityDataDir(env);
  const conversationCachePath = path.join(userDataDir, "cache", "last_conversations.json");

  return {
    id: backendId,
    modelProvider: backendId,
    liveTest: { defaultModelRef: `${backendId}/gemini-3.7-flash-medium` },
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
        "--dangerously-skip-permissions",
      ],
      resumeArgs: [
        "--conversation",
        "{sessionId}",
        "--print",
        "{prompt}",
        "--print-timeout",
        DEFAULT_PRINT_TIMEOUT,
        "--dangerously-skip-permissions",
      ],
      output: "text",
      input: "arg",
      modelArg: "--model",
      modelAliases: GOOGLE_ANTIGRAVITY_MODEL_ALIASES,
      systemPromptWhen: "first",
      sessionMode: "existing",
      serialize: true,
    },
  };
}
