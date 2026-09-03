import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleAntigravityProvider,
  buildModelCatalogRows,
  GOOGLE_ANTIGRAVITY_AUTH_MARKER,
  listGoogleAntigravityCatalog,
  MODEL_DEFINITIONS,
} from "./index.js";
import { GOOGLE_ANTIGRAVITY_PROVIDER_ID } from "./backend.js";
import {
  clearAntigravityModelsCache,
  STATIC_MODEL_FALLBACK,
} from "./models.js";

describe("buildGoogleAntigravityProvider", () => {
  it("registers provider metadata and synthetic auth marker", () => {
    const provider = buildGoogleAntigravityProvider(GOOGLE_ANTIGRAVITY_PROVIDER_ID, {
      probe: () => ({ ok: true, helpText: "--print --model --print-timeout" }),
    });

    expect(provider.id).toBe(GOOGLE_ANTIGRAVITY_PROVIDER_ID);
    expect(provider.resolveSyntheticAuth?.({} as any)).toEqual({
      apiKey: GOOGLE_ANTIGRAVITY_AUTH_MARKER,
      source: "local agy runtime",
      mode: "token",
    });
  });

  it("returns null synthetic auth when agy probe fails", () => {
    const provider = buildGoogleAntigravityProvider(GOOGLE_ANTIGRAVITY_PROVIDER_ID, {
      probe: () => ({ ok: false, reason: "agy not found" }),
    });
    expect(provider.resolveSyntheticAuth?.({} as any)).toBeNull();
  });

  it("resolves dynamic models with derived metadata for any id", () => {
    const provider = buildGoogleAntigravityProvider();

    const gemini = provider.resolveDynamicModel?.({ modelId: "gemini-3.7-flash-medium" } as any);
    expect(gemini).toEqual(
      expect.objectContaining({
        id: "gemini-3.7-flash-medium",
        provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
        contextWindow: 1_000_000,
        reasoning: true,
      }),
    );

    // Unknown-to-us Gemini id still resolves (heuristic).
    const future = provider.resolveDynamicModel?.({ modelId: "gemini-9.0-flash-high" } as any);
    expect(future).toEqual(
      expect.objectContaining({ contextWindow: 1_000_000, reasoning: true }),
    );

    // Claude and GPT get correct context windows (previously hardcoded to 1M).
    const claude = provider.resolveDynamicModel?.({ modelId: "claude-sonnet-4-6" } as any);
    expect(claude).toEqual(expect.objectContaining({ contextWindow: 200_000 }));
    const gpt = provider.resolveDynamicModel?.({ modelId: "gpt-oss-120b-medium" } as any);
    expect(gpt).toEqual(expect.objectContaining({ contextWindow: 128_000 }));
  });

  it("accepts any non-empty model ref as modern", () => {
    const provider = buildGoogleAntigravityProvider();
    expect(provider.isModernModelRef?.({ modelId: "gemini-3.8-flash-high" } as any)).toBe(true);
    expect(provider.isModernModelRef?.({ modelId: "" } as any)).toBe(false);
  });
});

describe("buildModelCatalogRows", () => {
  it("maps static definitions to unified catalog entries", () => {
    const rows = buildModelCatalogRows(GOOGLE_ANTIGRAVITY_PROVIDER_ID);
    expect(rows.length).toBe(MODEL_DEFINITIONS.length);
    expect(rows.every((row) => row.kind === "text")).toBe(true);
    expect(rows.every((row) => row.provider === GOOGLE_ANTIGRAVITY_PROVIDER_ID)).toBe(true);
    expect(rows.every((row) => row.source === "static")).toBe(true);
    const sonnet = rows.find((row) => row.model === "claude-sonnet-4-6");
    expect(sonnet?.capabilities).toEqual(
      expect.objectContaining({ reasoning: true, contextWindow: 200_000 }),
    );
  });
});

describe("listGoogleAntigravityCatalog", () => {
  afterEach(() => {
    clearAntigravityModelsCache();
    vi.unstubAllEnvs();
  });

  it("returns null when running under vitest to keep tests offline", async () => {
    // VITEST is set by the runner. Test the belt-and-braces NODE_ENV path too.
    vi.stubEnv("NODE_ENV", "test");
    const result = await listGoogleAntigravityCatalog({
      env: { ...process.env, NODE_ENV: "test" },
    } as any);
    expect(result).toBeNull();
  });

  it("returns null when live fetch cannot be reached and no cache exists", async () => {
    const result = await listGoogleAntigravityCatalog({
      env: { PATH: "/nonexistent" },
      timeoutMs: 500,
    } as any);
    expect(result).toBeNull();
  });
});

describe("STATIC_MODEL_FALLBACK", () => {
  it("only lists real agy model ids", () => {
    // The static fallback must not include IDs that agy has since dropped
    // (this used to include gemini-3.5-flash-*).
    for (const model of STATIC_MODEL_FALLBACK) {
      expect(model.id).not.toMatch(/gemini-3\.5-flash/);
    }
  });
});
