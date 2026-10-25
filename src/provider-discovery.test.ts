import type { ProviderPlugin } from "openclaw/plugin-sdk/plugin-entry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGoogleAntigravityProvider } from "./index.js";
import { getLiveAntigravityModels, STATIC_MODEL_FALLBACK } from "./models.js";
import providerDiscovery from "./provider-discovery.js";

vi.mock("./models.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models.js")>()),
  getLiveAntigravityModels: vi.fn(),
}));

type CatalogContext = Parameters<NonNullable<ProviderPlugin["catalog"]>["run"]>[0];

function catalogContext(env: NodeJS.ProcessEnv = { NODE_ENV: "production" }): CatalogContext {
  return {
    config: {},
    env,
    resolveProviderApiKey: () => ({ apiKey: undefined }),
    resolveProviderAuth: () => ({ apiKey: undefined, mode: "none", source: "none" }),
  };
}

describe.each([
  { surface: "full provider", build: () => buildGoogleAntigravityProvider() },
  { surface: "lightweight discovery entry", build: () => providerDiscovery },
])("$surface runtime catalog", ({ build }) => {
  afterEach(() => vi.resetAllMocks());

  it("publishes the live account inventory without adding stale static rows", async () => {
    const models = [
      {
        id: "gemini-9.0-flash",
        name: "Gemini 9.0 Flash",
        reasoning: true,
        contextWindow: 1_000_000,
        input: ["text", "image"] as const,
      },
    ];
    vi.mocked(getLiveAntigravityModels).mockResolvedValue({
      models,
      source: "live",
      fetchedAt: 1_000,
      expiresAt: 2_000,
    });
    const controller = new AbortController();
    const catalog = build().catalog;
    expect(catalog).toBeDefined();
    const context = { ...catalogContext(), signal: controller.signal };
    const result = await catalog?.run(context);

    expect(getLiveAntigravityModels).toHaveBeenCalledExactlyOnceWith({
      signal: controller.signal,
    });
    if (!result || !("provider" in result)) throw new Error("expected live provider catalog");
    expect(result.provider.models).toEqual([
      expect.objectContaining({
        ...models[0],
        agentRuntime: { id: "google-antigravity-cli" },
      }),
    ]);
    expect(result.provider.agentRuntime).toEqual({ id: "google-antigravity-cli" });
  });

  it("leaves unavailable live discovery to the offline static fallback", async () => {
    vi.mocked(getLiveAntigravityModels).mockResolvedValue(null);
    const provider = build();
    expect(await provider.catalog?.run(catalogContext())).toBeNull();
    expect(getLiveAntigravityModels).toHaveBeenCalledExactlyOnceWith({ signal: undefined });

    vi.mocked(getLiveAntigravityModels).mockClear();
    const fallback = await provider.staticCatalog?.run(catalogContext());
    if (!fallback || !("provider" in fallback)) throw new Error("expected static provider catalog");
    expect(fallback.provider.models.map((model) => model.id)).toEqual(
      STATIC_MODEL_FALLBACK.map((model) => model.id),
    );
    expect(getLiveAntigravityModels).not.toHaveBeenCalled();
  });

  it.each([{ NODE_ENV: "test" }, { VITEST: "true" }])(
    "keeps runtime discovery offline in test environments (%j)",
    async (env) => {
      expect(await build().catalog?.run(catalogContext(env))).toBeNull();
      expect(getLiveAntigravityModels).not.toHaveBeenCalled();
    },
  );
});
