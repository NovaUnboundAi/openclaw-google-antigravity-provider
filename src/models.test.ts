import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAntigravityModelsCache,
  deriveContextWindow,
  deriveModelMetadata,
  deriveReasoning,
  getLiveAntigravityModels,
  parseAgyModelsOutput,
  runAgyModels,
  STATIC_MODEL_FALLBACK,
  type AgyModelsRunner,
} from "./models.js";

describe("deriveContextWindow", () => {
  it("returns family-appropriate defaults", () => {
    expect(deriveContextWindow("gemini-3.8-flash-high")).toBe(1_000_000);
    expect(deriveContextWindow("claude-sonnet-4-6")).toBe(200_000);
    expect(deriveContextWindow("claude-opus-4-6-thinking")).toBe(200_000);
    expect(deriveContextWindow("gpt-oss-120b-medium")).toBe(128_000);
    expect(deriveContextWindow("unknown-model-xyz")).toBe(200_000);
  });
});

describe("deriveReasoning", () => {
  it("detects effort suffixes and Thinking variants", () => {
    expect(deriveReasoning("gemini-3.7-flash-high")).toBe(true);
    expect(deriveReasoning("gemini-3.7-flash-medium")).toBe(true);
    expect(deriveReasoning("gemini-3.7-flash-low")).toBe(true);
    expect(deriveReasoning("claude-opus-4-6-thinking")).toBe(true);
    expect(deriveReasoning("claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)")).toBe(true);
    expect(deriveReasoning("some-non-reasoning-id")).toBe(false);
  });
});

describe("deriveModelMetadata", () => {
  it("fills name/reasoning/contextWindow with sensible defaults", () => {
    expect(deriveModelMetadata("gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)")).toEqual({
      name: "Gemini 3.8 Flash (Medium)",
      reasoning: true,
      contextWindow: 1_000_000,
    });
    expect(deriveModelMetadata("gpt-oss-120b-medium")).toEqual({
      name: "gpt-oss-120b-medium",
      reasoning: true,
      contextWindow: 128_000,
    });
  });
});

describe("parseAgyModelsOutput", () => {
  it("parses tab-separated id/name lines and drops noise", () => {
    const raw = [
      "Fetching available models...",
      "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
      "gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)",
      "",
      "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
      "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
    ].join("\n");
    const models = parseAgyModelsOutput(raw);
    expect(models.map((m) => m.id)).toEqual([
      "gemini-3.8-flash-high",
      "gemini-3.8-flash-medium",
      "claude-sonnet-4-6",
      "gpt-oss-120b-medium",
    ]);
    const claude = models.find((m) => m.id === "claude-sonnet-4-6");
    expect(claude).toEqual({
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (Thinking)",
      reasoning: true,
      contextWindow: 200_000,
    });
  });

  it("deduplicates repeated ids", () => {
    const raw = "gemini-3.7-flash-high\tA\ngemini-3.7-flash-high\tB";
    expect(parseAgyModelsOutput(raw).map((m) => m.id)).toEqual(["gemini-3.7-flash-high"]);
  });

  it("returns [] for empty or garbage output", () => {
    expect(parseAgyModelsOutput("")).toEqual([]);
    expect(parseAgyModelsOutput("no tabs here\njust noise")).toEqual([]);
  });
});

describe("runAgyModels (real spawn)", () => {
  it("resolves an error result when the binary does not exist", async () => {
    const result = await runAgyModels({
      command: "/nonexistent/agy-binary",
      timeoutMs: 1_000,
    }).catch((err: unknown) => err);
    // Missing binary raises spawn error; the runner rejects with that error.
    expect(result).toBeInstanceOf(Error);
  });

  it("rejects with AbortError when the signal aborts before spawn", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAgyModels({ command: "agy", timeoutMs: 1_000, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("getLiveAntigravityModels", () => {
  afterEach(() => clearAntigravityModelsCache());

  const twoModels = "gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)";

  const okRunner = (stdout: string): AgyModelsRunner => async () => ({
    stdout,
    stderr: "",
    exitCode: 0,
  });

  const failRunner: AgyModelsRunner = async () => ({ stdout: "", stderr: "boom", exitCode: 1 });

  const throwRunner: AgyModelsRunner = async () => {
    throw new Error("network");
  };

  it("returns live models on success and caches them within TTL", async () => {
    const runner = vi.fn(okRunner(twoModels));
    const first = await getLiveAntigravityModels({ runner, ttlMs: 60_000 });
    expect(first?.source).toBe("live");
    expect(first?.models.map((m) => m.id)).toEqual([
      "gemini-3.7-flash-medium",
      "claude-sonnet-4-6",
    ]);
    expect(runner).toHaveBeenCalledTimes(1);

    // Second call within TTL should serve cache — no additional runner invocation.
    const second = await getLiveAntigravityModels({ runner, ttlMs: 60_000 });
    expect(second?.source).toBe("cache");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expiry", async () => {
    let currentTime = 1_000_000;
    const now = () => currentTime;
    const runner = vi.fn(okRunner(twoModels));

    await getLiveAntigravityModels({ runner, ttlMs: 1_000, now });
    expect(runner).toHaveBeenCalledTimes(1);

    currentTime += 5_000; // past TTL
    await getLiveAntigravityModels({ runner, ttlMs: 1_000, now });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("returns null when live fetch fails and no cache exists", async () => {
    expect(await getLiveAntigravityModels({ runner: failRunner })).toBeNull();
    expect(await getLiveAntigravityModels({ runner: throwRunner })).toBeNull();
  });

  it("serves stale cache when refresh fails after the entry expired", async () => {
    let currentTime = 1_000_000;
    const now = () => currentTime;
    const runner = vi.fn<AgyModelsRunner>(okRunner(twoModels));

    await getLiveAntigravityModels({ runner, ttlMs: 1_000, now });
    // Now break the runner.
    runner.mockImplementation(failRunner);
    currentTime += 10_000; // past TTL
    const stale = await getLiveAntigravityModels({ runner, ttlMs: 1_000, now });
    expect(stale?.source).toBe("cache");
    expect(stale?.models.length).toBe(2);
  });

  it("deduplicates concurrent callers into a single fetch", async () => {
    let resolveFetch: ((result: { stdout: string; stderr: string; exitCode: number }) => void) | undefined;
    const runner = vi.fn<AgyModelsRunner>(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const p1 = getLiveAntigravityModels({ runner });
    const p2 = getLiveAntigravityModels({ runner });
    expect(runner).toHaveBeenCalledTimes(1);

    resolveFetch?.({ stdout: twoModels, stderr: "", exitCode: 0 });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1?.source).toBe("live");
    expect(r2?.source).toBe("live");
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe("STATIC_MODEL_FALLBACK", () => {
  it("uses real agy IDs (dashes, effort suffix)", () => {
    const ids = STATIC_MODEL_FALLBACK.map((m) => m.id);
    // Claude/Opus IDs must use dashes, not dots — those are display labels.
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).not.toContain("claude-sonnet-4.6");
    // GPT-OSS must include the effort suffix.
    expect(ids).toContain("gpt-oss-120b-medium");
    expect(ids).not.toContain("gpt-oss-120b");
  });
});
