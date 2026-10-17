import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import plugin from "../plugin.js";
import providerDiscovery from "../provider-discovery.js";
import {
  GOOGLE_ANTIGRAVITY_DEFAULT_MODEL_REF,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
} from "./backend.js";
import { buildGoogleAntigravityProvider } from "./index.js";

describe("self-contained package entries", () => {
  it("loads the source plugin and provider discovery entries", async () => {
    expect(plugin.id).toBe("google-antigravity-cli");
    expect(providerDiscovery.id).toBe("google-antigravity-cli");
    const catalog = await providerDiscovery.staticCatalog?.run({} as any);
    expect(catalog && "provider" in catalog).toBe(true);
    if (!catalog || !("provider" in catalog)) {
      throw new Error("expected provider catalog");
    }
    expect(catalog.provider.models.some((model) => model.input.includes("image"))).toBe(true);
  });

  it("keeps manifest, runtime fallback and default model aligned with the current baseline", async () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
    );
    const manifestProvider = manifest.modelCatalog.providers[GOOGLE_ANTIGRAVITY_PROVIDER_ID];
    expect(manifestProvider.models.map((model: { id: string }) => model.id)).toEqual([
      "gemini-3.8-flash",
      "claude-sonnet-4-6",
      "claude-opus-4-6-thinking",
      "gpt-oss-120b-medium",
    ]);
    expect(`${GOOGLE_ANTIGRAVITY_PROVIDER_ID}/${manifestProvider.defaultModel}`).toBe(
      GOOGLE_ANTIGRAVITY_DEFAULT_MODEL_REF,
    );
    expect(manifestProvider.models.some(
      (model: { id: string }) => model.id === manifestProvider.defaultModel,
    )).toBe(true);

    for (const provider of [providerDiscovery, buildGoogleAntigravityProvider()]) {
      const catalog = await provider.staticCatalog?.run({} as any);
      if (!catalog || !("provider" in catalog)) {
        throw new Error("expected provider catalog");
      }
      expect(catalog.provider.models.map(({ maxTokens, agentRuntime, ...model }) => model)).toEqual(
        manifestProvider.models,
      );
    }
  });
});
