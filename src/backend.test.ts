import { describe, expect, it } from "vitest";
import {
  buildGoogleAntigravityCliBackend,
  GOOGLE_ANTIGRAVITY_MODEL_ALIASES,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  normalizeGoogleAntigravityBackendConfig,
  parseGoogleAntigravityJsonlEvent,
  resolveGoogleAntigravityExecutionArgs,
} from "./backend.js";

describe("google-antigravity-cli CLI backend", () => {
  it("declares the CLI backend structure with 30m0s default timeout and parseJsonlEvent", () => {
    const backend = buildGoogleAntigravityCliBackend();

    expect(backend.id).toBe(GOOGLE_ANTIGRAVITY_PROVIDER_ID);
    expect(backend.nativeToolMode).toBe("always-on");
    expect(backend.ownsNativeCompaction).toBe(true);
    expect(typeof (backend as any).parseJsonlEvent).toBe("function");
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

    // 2. Optional streaming enabled in plugin config
    const res2 = resolveGoogleAntigravityExecutionArgs({
      config: {
        plugins: {
          entries: {
            "google-antigravity-cli": {
              config: {
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
        plugins: {
          entries: {
            "google-antigravity-cli": {
              config: {
                stream: true,
              },
            },
          },
        },
      } as any,
    });

    expect(normalized.output).toBe("jsonl");
    expect((normalized as any).resumeOutput).toBe("jsonl");
  });

  describe("parseGoogleAntigravityJsonlEvent", () => {
    const ctx = {
      backendId: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      backend: buildGoogleAntigravityCliBackend().config,
    };

    it("parses init event as sessionId", () => {
      const line = JSON.stringify({
        event: "init",
        conversation_id: "9277298e-cc25-4e13-a4bf-a98358aeef34",
        init: { model: "gemini-3.7-flash-high" },
      });
      const parsed = parseGoogleAntigravityJsonlEvent(line, ctx);
      expect(parsed).toEqual({
        kind: "sessionId",
        sessionId: "9277298e-cc25-4e13-a4bf-a98358aeef34",
      });
    });

    it("parses thinking and text deltas from step_update", () => {
      // Thinking delta
      const thinkingLine = JSON.stringify({
        event: "step_update",
        step_update: {
          step_index: 2,
          step_type: "thinking",
          thought_delta: "Analyzing problem constraints...",
        },
      });
      expect(parseGoogleAntigravityJsonlEvent(thinkingLine, ctx)).toEqual({
        kind: "thinking",
        text: "Analyzing problem constraints...",
      });

      // Text delta
      const textLine = JSON.stringify({
        event: "step_update",
        step_update: {
          step_index: 2,
          step_type: "agent_response",
          text_delta: "The answer is 42.",
        },
      });
      expect(parseGoogleAntigravityJsonlEvent(textLine, ctx)).toEqual({
        kind: "text",
        text: "The answer is 42.",
      });
    });

    it("parses tool start and result lifecycle from step_update", () => {
      // Tool Start
      const toolStartLine = JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "9277298e-cc25-4e13-a4bf-a98358aeef34",
          step_index: 3,
          state: "ACTIVE",
          step_type: "tool",
          tool_name: "view_file",
          tool_info: {
            name: "view_file",
            parameters: { AbsolutePath: "transcript.jsonl" },
          },
        },
      });
      expect(parseGoogleAntigravityJsonlEvent(toolStartLine, ctx)).toEqual({
        kind: "toolStart",
        toolCallId: "call_3",
        name: "view_file",
        args: { AbsolutePath: "transcript.jsonl" },
      });

      // Tool Result
      const toolDoneLine = JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "9277298e-cc25-4e13-a4bf-a98358aeef34",
          step_index: 3,
          state: "DONE",
          step_type: "tool",
          tool_name: "view_file",
          tool_info: {
            name: "view_file",
            parameters: { AbsolutePath: "transcript.jsonl" },
            output: "4 lines, 2594 bytes",
          },
        },
      });
      expect(parseGoogleAntigravityJsonlEvent(toolDoneLine, ctx)).toEqual({
        kind: "toolResult",
        toolCallId: "call_3",
        name: "view_file",
        isError: false,
        result: "4 lines, 2594 bytes",
      });
    });

    it("parses terminal result and usage metrics", () => {
      const line = JSON.stringify({
        event: "result",
        result: {
          conversation_id: "9277298e-cc25-4e13-a4bf-a98358aeef34",
          status: "SUCCESS",
          response: "Final solution text",
          usage: {
            input_tokens: 19525,
            output_tokens: 315,
            thinking_tokens: 224,
            cache_read_tokens: 0,
            total_tokens: 19840,
          },
        },
      });
      const parsed = parseGoogleAntigravityJsonlEvent(line, ctx);
      expect(parsed).toEqual({
        kind: "result",
        text: "Final solution text",
        sessionId: "9277298e-cc25-4e13-a4bf-a98358aeef34",
        usage: {
          input: 19525,
          output: 315,
          cacheRead: 0,
          total: 19840,
        },
      });
    });
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

  describe("manualCompaction", () => {
    it("builds default and custom compaction prompts", () => {
      const backend = buildGoogleAntigravityCliBackend();
      expect(backend.manualCompaction).toBeDefined();
      expect(backend.manualCompaction?.input).toBe("arg");

      expect(backend.manualCompaction?.buildPrompt()).toContain("Do not execute any tools");
      expect(backend.manualCompaction?.buildPrompt("preserve architectural decisions")).toContain(
        "preserve architectural decisions",
      );
    });

    it("validates successful and error process outputs", () => {
      const backend = buildGoogleAntigravityCliBackend();
      const validate = backend.manualCompaction?.validateOutput;
      expect(validate).toBeDefined();

      // Empty output
      expect(validate!("")).toEqual({
        ok: false,
        reason: "Antigravity CLI returned empty output during compaction.",
      });

      // Stream-json success
      const successJson = JSON.stringify({
        event: "result",
        result: { status: "SUCCESS", response: "Summary of conversation" },
      });
      expect(validate!(successJson)).toEqual({ ok: true });

      // Stream-json error
      const errorJson = JSON.stringify({
        event: "result",
        result: { status: "ERROR", error: "Context limit exceeded" },
      });
      expect(validate!(errorJson)).toEqual({
        ok: false,
        reason: "Context limit exceeded",
      });

      // Conversation not found in text
      expect(validate!("warning: conversation \"a6b1a47baa29\" not found")).toEqual({
        ok: false,
        reason:
          "Antigravity native conversation not found for this session. Send a message first to establish the conversation before compacting.",
      });

      // Context canceled in JSON
      const canceledJson = JSON.stringify({
        event: "result",
        result: { status: "ERROR", error: "context canceled" },
      });
      expect(validate!(canceledJson)).toEqual({
        ok: false,
        reason:
          "Antigravity native conversation not found or canceled. Send a message first to initialize the native conversation before compacting.",
      });

      // Plain text output
      expect(validate!("Here is the summary of the conversation...")).toEqual({ ok: true });
    });
  });
});

