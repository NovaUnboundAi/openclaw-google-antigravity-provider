import { describe, expect, it } from "vitest";
import {
  buildGoogleAntigravityCliBackend,
  GOOGLE_ANTIGRAVITY_MODEL_ALIASES,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  normalizeGoogleAntigravityBackendConfig,
  resolveGoogleAntigravityExecutionArgs,
} from "./backend.js";

describe("google-antigravity-cli CLI backend", () => {
  it("declares the CLI backend structure with 30m0s default timeout", () => {
    const backend = buildGoogleAntigravityCliBackend();

    expect(backend.id).toBe(GOOGLE_ANTIGRAVITY_PROVIDER_ID);
    expect(backend.nativeToolMode).toBe("always-on");
    expect(backend.ownsNativeCompaction).toBe(true);
    expect(backend.config).toEqual(
      expect.objectContaining({
        command: "agy",
        args: ["--print", "{prompt}", "--print-timeout", "30m0s", "--dangerously-skip-permissions"],
        resumeArgs: [
          "--conversation",
          "{sessionId}",
          "--print",
          "{prompt}",
          "--print-timeout",
          "30m0s",
          "--dangerously-skip-permissions",
        ],
        input: "arg",
        output: "text",
        modelArg: "--model",
        sessionMode: "existing",
        serialize: true,
      }),
    );
    expect(GOOGLE_ANTIGRAVITY_MODEL_ALIASES).toMatchObject({
      flash: "gemini-3.7-flash-medium",
      pro: "gemini-3.1-pro-high",
      "pro-high": "gemini-3.1-pro-high",
      sonnet: "claude-sonnet-4.6",
    });
  });

  it("dynamically resolves --print-timeout and optional streaming flags", () => {
    const baseArgs = ["--print", "{prompt}", "--print-timeout", "30m0s"];

    // 1. Model-specific timeout
    const res1 = resolveGoogleAntigravityExecutionArgs({
      config: {
        agents: {
          defaults: {
            models: {
              "google-antigravity-cli/gemini-3.7-flash-medium": {
                params: { timeoutSeconds: 900 },
              },
            },
          },
        },
      } as any,
      workspaceDir: "/tmp",
      provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      modelId: "google-antigravity-cli/gemini-3.7-flash-medium",
      authProfileId: undefined,
      thinkingLevel: undefined,
      executionMode: "agent",
      useResume: false,
      baseArgs,
    });
    expect(res1).toEqual(["--print", "{prompt}", "--print-timeout", "900s"]);

    // 2. Optional streaming enabled in cliBackends
    const res2 = resolveGoogleAntigravityExecutionArgs({
      config: {
        agents: {
          defaults: {
            cliBackends: {
              "google-antigravity-cli": {
                stream: true,
                printTimeout: "15m0s",
              },
            },
          },
        },
      } as any,
      workspaceDir: "/tmp",
      provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      modelId: "gemini-3.7-flash-medium",
      authProfileId: undefined,
      thinkingLevel: undefined,
      executionMode: "agent",
      useResume: false,
      baseArgs,
    });
    expect(res2).toEqual([
      "--print",
      "{prompt}",
      "--print-timeout",
      "15m0s",
      "--output-format",
      "stream-json",
    ]);
  });

  it("normalizes output mode to jsonl when streaming is configured", () => {
    const backend = buildGoogleAntigravityCliBackend();
    const normalized = normalizeGoogleAntigravityBackendConfig(backend.config, {
      backendId: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      config: {
        agents: {
          defaults: {
            cliBackends: {
              "google-antigravity-cli": {
                stream: true,
              },
            },
          },
        },
      } as any,
    });

    expect(normalized.output).toBe("jsonl");
  });

  it("forwards ANTIGRAVITY_USER_DATA_DIR and clears raw Google API credentials", async () => {
    const backend = buildGoogleAntigravityCliBackend("google-antigravity-cli", {
      ANTIGRAVITY_USER_DATA_DIR: " /tmp/antigravity-profile ",
      GEMINI_API_KEY: "secret",
    });

    const prepared = await backend.prepareExecution?.({
      workspaceDir: "/tmp/workspace",
      provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      modelId: "gemini-3.7-flash-medium",
    });

    expect(prepared).toEqual(
      expect.objectContaining({
        env: { ANTIGRAVITY_USER_DATA_DIR: "/tmp/antigravity-profile" },
        clearEnv: [
          "GEMINI_API_KEY",
          "GOOGLE_API_KEY",
          "GOOGLE_APPLICATION_CREDENTIALS",
          "GOOGLE_CLOUD_PROJECT",
          "GOOGLE_CLOUD_PROJECT_ID",
        ],
      }),
    );
  });
});
