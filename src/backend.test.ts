import { describe, expect, it } from "vitest";
import {
  buildGoogleAntigravityCliBackend,
  GOOGLE_ANTIGRAVITY_MODEL_ALIASES,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  resolveGoogleAntigravityExecutionArgs,
} from "./backend.js";

describe("google-antigravity-cli CLI backend", () => {
  it("declares the CLI backend structure with 30m0s default timeout", () => {
    const backend = buildGoogleAntigravityCliBackend({});

    expect(backend.id).toBe(GOOGLE_ANTIGRAVITY_PROVIDER_ID);
    expect(backend.nativeToolMode).toBe("always-on");
    expect(backend.config).toEqual(
      expect.objectContaining({
        command: "agy",
        args: ["--print", "{prompt}", "--print-timeout", "30m0s"],
        resumeArgs: [
          "--conversation",
          "{sessionId}",
          "--print",
          "{prompt}",
          "--print-timeout",
          "30m0s",
        ],
        input: "arg",
        output: "text",
        modelArg: "--model",
        sessionMode: "existing",
        serialize: true,
      }),
    );
    expect(GOOGLE_ANTIGRAVITY_MODEL_ALIASES).toMatchObject({
      flash: "Gemini 3.5 Flash (Medium)",
      pro: "Gemini 3.1 Pro (High)",
      "pro-high": "Gemini 3.1 Pro (High)",
      sonnet: "Claude Sonnet 4.6 (Thinking)",
    });
  });

  it("dynamically resolves --print-timeout from model/backend config", () => {
    const baseArgs = ["--print", "{prompt}", "--print-timeout", "30m0s"];

    // 1. Model-specific timeout
    const res1 = resolveGoogleAntigravityExecutionArgs({
      config: {
        agents: {
          defaults: {
            models: {
              "google-antigravity-cli/gemini-3.5-flash": {
                params: { timeoutSeconds: 900 },
              },
            },
          },
        },
      } as any,
      workspaceDir: "/tmp",
      provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      modelId: "google-antigravity-cli/gemini-3.5-flash",
      authProfileId: undefined,
      thinkingLevel: undefined,
      executionMode: "agent",
      useResume: false,
      baseArgs,
    });
    expect(res1).toEqual(["--print", "{prompt}", "--print-timeout", "900s"]);

    // 2. cliBackends explicit printTimeout
    const res2 = resolveGoogleAntigravityExecutionArgs({
      config: {
        agents: {
          defaults: {
            cliBackends: {
              "google-antigravity-cli": {
                printTimeout: "15m0s",
              },
            },
          },
        },
      } as any,
      workspaceDir: "/tmp",
      provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      modelId: "gemini-3.5-flash",
      authProfileId: undefined,
      thinkingLevel: undefined,
      executionMode: "agent",
      useResume: false,
      baseArgs,
    });
    expect(res2).toEqual(["--print", "{prompt}", "--print-timeout", "15m0s"]);
  });

  it("forwards ANTIGRAVITY_USER_DATA_DIR and clears raw Google API credentials", async () => {
    const backend = buildGoogleAntigravityCliBackend({
      ANTIGRAVITY_USER_DATA_DIR: " /tmp/antigravity-profile ",
      GEMINI_API_KEY: "secret",
    });

    const prepared = await backend.prepareExecution?.({
      workspaceDir: "/tmp/workspace",
      provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      modelId: "gemini-3.5-flash",
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
