import { describe, expect, it } from "vitest";
import {
  buildAntigravityProviderCatalog,
  buildGoogleAntigravityProvider,
  GOOGLE_ANTIGRAVITY_AUTH_MARKER,
  MODEL_DEFINITIONS,
} from "./index.js";
import { GOOGLE_ANTIGRAVITY_PROVIDER_ID } from "./backend.js";

describe("buildGoogleAntigravityProvider", () => {
  it("registers provider metadata and models", async () => {
    const provider = buildGoogleAntigravityProvider(GOOGLE_ANTIGRAVITY_PROVIDER_ID, {
      probe: () => ({ ok: true, helpText: "--print --model --print-timeout" }),
    });

    expect(provider.id).toBe(GOOGLE_ANTIGRAVITY_PROVIDER_ID);
    expect(provider.resolveSyntheticAuth?.({} as any)).toEqual({
      apiKey: GOOGLE_ANTIGRAVITY_AUTH_MARKER,
      source: "local agy runtime",
      mode: "api-key",
    });

    const catalog = (await provider.augmentModelCatalog?.({} as any)) ?? [];
    expect(catalog.length).toBe(MODEL_DEFINITIONS.length);
    expect(catalog.filter((model) => model.id.startsWith("gemini-3.8-flash-")))
      .toHaveLength(3);
    expect(catalog.some((model) => model.id.startsWith("gemini-3.5-flash")))
      .toBe(false);
    expect(catalog.some((m) => m.id === "gemini-3.7-flash-medium")).toBe(true);
    expect(catalog.some((m) => m.id === "claude-sonnet-4.6")).toBe(true);
  });

  it("persists a non-secret local-runtime marker during provider login", async () => {
    const provider = buildGoogleAntigravityProvider(GOOGLE_ANTIGRAVITY_PROVIDER_ID, {
      probe: () => ({ ok: true, helpText: "--print --model --print-timeout" }),
    });
    const result = await provider.auth?.[0]?.run({
      config: {
        agents: {
          defaults: {
            modelPolicy: { allow: ["openai/*"] },
          },
        },
      },
      prompter: {
        note: async () => undefined,
        confirm: async () => true,
      },
    } as any);

    expect(result?.profiles).toEqual([
      {
        profileId: `${GOOGLE_ANTIGRAVITY_PROVIDER_ID}:local`,
        credential: {
          type: "api_key",
          provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
          key: GOOGLE_ANTIGRAVITY_AUTH_MARKER,
        },
      },
    ]);
    expect(Object.keys(result?.configPatch?.agents?.defaults?.models ?? {})).toEqual(
      MODEL_DEFINITIONS.map((model) =>
        `${GOOGLE_ANTIGRAVITY_PROVIDER_ID}/${model.id}`,
      ),
    );
    expect(result?.configPatch?.agents?.defaults?.modelPolicy?.allow).toEqual([
      "openai/*",
      ...MODEL_DEFINITIONS.map(
        (model) => `${GOOGLE_ANTIGRAVITY_PROVIDER_ID}/${model.id}`,
      ),
    ]);
  });

  it("resolves dynamic models with 1M context", () => {
    const provider = buildGoogleAntigravityProvider();
    const model = provider.resolveDynamicModel?.({
      modelId: "gemini-3.7-flash-medium",
    } as any);

    expect(model).toEqual(
      expect.objectContaining({
        id: "gemini-3.7-flash-medium",
        provider: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
        contextWindow: 1_000_000,
        reasoning: true,
      }),
    );
  });

  it("preserves provider-specific Claude and GPT context windows", () => {
    const provider = buildGoogleAntigravityProvider();

    expect(
      provider.resolveDynamicModel?.({ modelId: "claude-sonnet-4.6" } as any)
        ?.contextWindow,
    ).toBe(200_000);
    expect(
      provider.resolveDynamicModel?.({ modelId: "gpt-oss-120b" } as any)?.contextWindow,
    ).toBe(128_000);
  });

  it("publishes a self-routed static catalog for prepared model pickers", async () => {
    const provider = buildGoogleAntigravityProvider(GOOGLE_ANTIGRAVITY_PROVIDER_ID, {
      probe: () => ({ ok: true, helpText: "--print --model --print-timeout" }),
    });

    const result = await provider.staticCatalog?.run({} as any);
    expect(result).toEqual({
      provider: buildAntigravityProviderCatalog(GOOGLE_ANTIGRAVITY_PROVIDER_ID),
    });
    expect(result && "provider" in result).toBe(true);
    if (!result || !("provider" in result)) {
      throw new Error("expected a single-provider static catalog");
    }
    expect(result.provider.agentRuntime).toEqual({
      id: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
    });
    expect(result.provider.models).toHaveLength(MODEL_DEFINITIONS.length);
    expect(
      result.provider.models.every(
        (model) => model.agentRuntime?.id === GOOGLE_ANTIGRAVITY_PROVIDER_ID,
      ),
    ).toBe(true);
  });
});
