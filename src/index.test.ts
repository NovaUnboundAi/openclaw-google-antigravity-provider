import { describe, expect, it } from "vitest";
import {
  buildGoogleAntigravityProvider,
  GOOGLE_ANTIGRAVITY_AUTH_MARKER,
  MODEL_DEFINITIONS,
} from "./index.js";
import { GOOGLE_ANTIGRAVITY_PROVIDER_ID } from "./backend.js";

describe("buildGoogleAntigravityProvider", () => {
  it("registers provider metadata and models", () => {
    const provider = buildGoogleAntigravityProvider({
      probe: () => ({ ok: true, helpText: "--print --model --print-timeout" }),
    });

    expect(provider.id).toBe(GOOGLE_ANTIGRAVITY_PROVIDER_ID);
    expect(provider.resolveSyntheticAuth?.({} as any)).toEqual({
      apiKey: GOOGLE_ANTIGRAVITY_AUTH_MARKER,
      source: "local agy runtime",
      mode: "token",
    });

    const catalog = provider.augmentModelCatalog?.({} as any) ?? [];
    expect(catalog.length).toBe(MODEL_DEFINITIONS.length);
    expect(catalog.some((m) => m.id === "gemini-3.5-flash-high")).toBe(true);
    expect(catalog.some((m) => m.id === "claude-sonnet-4.6")).toBe(true);
  });

  it("resolves dynamic models with 1M context", () => {
    const provider = buildGoogleAntigravityProvider();
    const model = provider.resolveDynamicModel?.({
      modelId: "gemini-3.5-flash-high",
    } as any);

    expect(model).toEqual(
      expect.objectContaining({
        id: "gemini-3.5-flash-high",
        provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
        contextWindow: 1_000_000,
        reasoning: true,
      }),
    );
  });
});
