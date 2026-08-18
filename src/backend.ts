import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type {
  CliBackendPlugin,
  CliBackendResolveExecutionArgsContext,
} from "openclaw/plugin-sdk/cli-backend";
import { DEFAULT_PRINT_TIMEOUT, formatGoDuration } from "./config.js";

export const GOOGLE_ANTIGRAVITY_PROVIDER_ID = "google-antigravity-cli";
export const GOOGLE_ANTIGRAVITY_DEFAULT_MODEL_REF =
  "google-antigravity-cli/gemini-3.5-flash";

export const GOOGLE_ANTIGRAVITY_MODEL_ALIASES: Record<string, string> = {
  flash: "Gemini 3.5 Flash (Medium)",
  pro: "Gemini 3.1 Pro (High)",
  "pro-low": "Gemini 3.1 Pro (Low)",
  "pro-high": "Gemini 3.1 Pro (High)",
  sonnet: "Claude Sonnet 4.6 (Thinking)",
  opus: "Claude Opus 4.6 (Thinking)",
  gpt: "GPT-OSS 120B (Medium)",
  "gemini-3.5-flash": "Gemini 3.5 Flash (Medium)",
  "gemini-3.5-flash-medium": "Gemini 3.5 Flash (Medium)",
  "gemini-3.5-flash-high": "Gemini 3.5 Flash (High)",
  "gemini-3.5-flash-low": "Gemini 3.5 Flash (Low)",
  "gemini-3.1-pro-low": "Gemini 3.1 Pro (Low)",
  "gemini-3.1-pro-high": "Gemini 3.1 Pro (High)",
  "claude-sonnet-4.6": "Claude Sonnet 4.6 (Thinking)",
  "claude-opus-4.6": "Claude Opus 4.6 (Thinking)",
  "gpt-oss-120b": "GPT-OSS 120B (Medium)",
  "Gemini 3.5 Flash (Medium)": "Gemini 3.5 Flash (Medium)",
  "Gemini 3.5 Flash (High)": "Gemini 3.5 Flash (High)",
  "Gemini 3.5 Flash (Low)": "Gemini 3.5 Flash (Low)",
  "Gemini 3.1 Pro (Low)": "Gemini 3.1 Pro (Low)",
  "Gemini 3.1 Pro (High)": "Gemini 3.1 Pro (High)",
  "Claude Sonnet 4.6 (Thinking)": "Claude Sonnet 4.6 (Thinking)",
  "Claude Opus 4.6 (Thinking)": "Claude Opus 4.6 (Thinking)",
  "GPT-OSS 120B (Medium)": "GPT-OSS 120B (Medium)",
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

export function resolveGoogleAntigravityExecutionArgs(
  context: CliBackendResolveExecutionArgsContext,
): string[] {
  const cfg = context.config as Record<string, any> | undefined;
  const backendConfig = cfg?.agents?.defaults?.cliBackends?.[GOOGLE_ANTIGRAVITY_PROVIDER_ID];

  const configuredTimeout =
    backendConfig?.printTimeout ??
    cfg?.agents?.defaults?.models?.[context.modelId]?.params?.timeoutSeconds ??
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

  return args;
}

export function buildGoogleAntigravityCliBackend(
  env: NodeJS.ProcessEnv = process.env,
): CliBackendPlugin {
  const userDataDir = resolveAntigravityDataDir(env);
  const conversationCachePath = path.join(userDataDir, "cache", "last_conversations.json");

  return {
    id: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
    modelProvider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
    liveTest: { defaultModelRef: GOOGLE_ANTIGRAVITY_DEFAULT_MODEL_REF },
    nativeToolMode: "always-on",
    ownsNativeCompaction: true,
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
      args: ["--print", "{prompt}", "--print-timeout", DEFAULT_PRINT_TIMEOUT],
      resumeArgs: [
        "--conversation",
        "{sessionId}",
        "--print",
        "{prompt}",
        "--print-timeout",
        DEFAULT_PRINT_TIMEOUT,
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
