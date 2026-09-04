import {
  definePluginEntry,
  type OpenClawPluginApi,
  type OpenClawPluginDefinition,
  type ProviderAuthContext,
  type ProviderRuntimeModel,
  type UnifiedModelCatalogEntry,
  type ProviderPlugin,
  type UnifiedModelCatalogProviderContext,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  buildGoogleAntigravityCliBackend,
  GOOGLE_ANTIGRAVITY_DEFAULT_MODEL_REF,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
} from "./backend.js";
import {
  clearAntigravityModelsCache,
  DEFAULT_LIVE_TIMEOUT_MS,
  deriveModelMetadata,
  getLiveAntigravityModels,
  STATIC_MODEL_FALLBACK,
  type AntigravityModel,
} from "./models.js";
import { probeAgy, type AgyProbeResult } from "./probe.js";
import { registerAntigravitySessionCatalog } from "./session-catalog.js";

export const GOOGLE_ANTIGRAVITY_AUTH_MARKER = "antigravity-local-session";

// Compile-time list. `staticCatalog` returns this; the live list is fetched
// on demand via `getLiveAntigravityModels()`.
export const MODEL_DEFINITIONS: readonly AntigravityModel[] = STATIC_MODEL_FALLBACK;

function buildRuntimeModel(providerId: string, modelId: string): ProviderRuntimeModel {
  const meta = deriveModelMetadata(modelId);
  return {
    id: modelId,
    name: meta.name,
    provider: providerId,
    api: "google-generative-ai",
    baseUrl: "http://antigravity.local",
    reasoning: meta.reasoning,
    input: [...meta.input],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: meta.contextWindow,
    maxTokens: 65_536,
  };
}

async function buildAntigravityConfigPatch(
  providerId = GOOGLE_ANTIGRAVITY_PROVIDER_ID,
): Promise<Record<string, unknown>> {
  // OpenClaw's `/models` picker (`src/auto-reply/reply/commands-models.ts`,
  // v2026.8.1) instantiates its auth checker with
  // `allowPluginSyntheticAuth: false`, which means our plugin-declared
  // `syntheticAuthRefs` is ignored in that code path. The synthetic-auth
  // check then falls back to requiring
  // `providerConfig.models.length > 0`. Without that, `/models` never
  // surfaces this provider, even though its plugin-registered catalog is
  // populated. Snapshot the current live catalog (or the static fallback)
  // into `models.providers.<id>.models[]` so the picker sees it.
  const live = await getLiveAntigravityModels();
  const models = live?.models ?? STATIC_MODEL_FALLBACK;
  return {
    models: {
      providers: {
        [providerId]: {
          baseUrl: "http://antigravity.local",
          api: "google-generative-ai",
          models: models.map((model) => ({
            id: model.id,
            name: model.name,
            reasoning: model.reasoning,
            input: [...model.input],
            contextWindow: model.contextWindow,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          })),
        },
      },
    },
    agents: {
      defaults: {
        models: {
          // Wildcard mapping routes every Antigravity model ID through the
          // CLI backend, so new models Google ships without a plugin release
          // pick up the same routing automatically.
          [`${providerId}/*`]: { agentRuntime: { id: providerId } },
        },
      },
    },
  };
}

function shouldSkipLiveFetch(env: NodeJS.ProcessEnv): boolean {
  // Match bundled plugins (deepinfra, openrouter): keep tests offline so
  // catalog tests don't shell out to a real `agy` binary.
  return env.NODE_ENV === "test" || Boolean(env.VITEST);
}

function toCatalogEntry(
  providerId: string,
  model: AntigravityModel,
  source: UnifiedModelCatalogEntry["source"],
  timestamps?: { fetchedAt: number; expiresAt: number },
): UnifiedModelCatalogEntry {
  return {
    kind: "text",
    provider: providerId,
    model: model.id,
    label: model.name,
    source,
    capabilities: {
      reasoning: model.reasoning,
      input: [...model.input],
      contextWindow: model.contextWindow,
    },
    ...(timestamps ?? {}),
  };
}

export function buildModelCatalogRows(
  providerId: string,
  source: UnifiedModelCatalogEntry["source"] = "static",
  models: readonly AntigravityModel[] = MODEL_DEFINITIONS,
): UnifiedModelCatalogEntry[] {
  return models.map((model) => toCatalogEntry(providerId, model, source));
}

export type BuildGoogleAntigravityProviderOptions = {
  probe?: () => AgyProbeResult;
};

export function buildGoogleAntigravityProvider(
  providerId = GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  options: BuildGoogleAntigravityProviderOptions = {},
): ProviderPlugin {
  const runProbe = options.probe ?? probeAgy;
  return {
    id: providerId,
    label: "Google Antigravity CLI",
    docsPath: "/gateway/cli-backends",
    envVars: ["ANTIGRAVITY_USER_DATA_DIR"],
    auth: [
      {
        id: "custom",
        label: "Google Antigravity CLI",
        hint: "Delegate text inference to a local signed-in agy CLI",
        kind: "custom",
        run: async (ctx: ProviderAuthContext) => {
          await ctx.prompter.note(
            [
              "OpenClaw delegates agent turns to the local agy --print harness.",
              "OpenClaw binds each chat to its own persistent Antigravity conversation and resumes it by id.",
              "The harness supports process cancellation and Antigravity's native tools.",
              "Antigravity owns Google authentication and session state.",
            ].join("\n"),
            "Google Antigravity CLI",
          );

          if (
            !(await ctx.prompter.confirm({
              message: "Configure the local Antigravity agy runtime?",
              initialValue: false,
            }))
          ) {
            return { profiles: [] };
          }

          const result = runProbe();
          if (!result.ok) {
            throw new Error(result.reason);
          }

          return {
            profiles: [],
            defaultModel: GOOGLE_ANTIGRAVITY_DEFAULT_MODEL_REF,
            configPatch: await buildAntigravityConfigPatch(providerId),
            notes: [
              "Uses the local signed-in agy runtime. OpenClaw does not import or persist Antigravity OAuth tokens.",
              "Prompts are passed through agy --print as command-line arguments.",
              "Persistent Antigravity conversation ids are stored in the normal OpenClaw CLI session binding.",
            ],
          };
        },
      },
    ],
    wizard: {
      setup: {
        choiceId: providerId,
        choiceLabel: "Google Antigravity CLI",
        choiceHint: "Delegate text inference to a local signed-in agy CLI",
        groupId: providerId,
        groupLabel: "Google Antigravity CLI",
        groupHint: "Local CLI runtime",
        methodId: "custom",
      },
    },
    resolveSyntheticAuth: () => {
      if (!runProbe().ok) return null;
      return {
        apiKey: GOOGLE_ANTIGRAVITY_AUTH_MARKER,
        source: "local agy runtime",
        mode: "token",
      };
    },
    resolveDynamicModel: ({ modelId }: { modelId: string }) =>
      buildRuntimeModel(providerId, modelId),
    // Any well-formed ID is routable — the plugin forwards it verbatim to
    // `agy --model`. OpenClaw's own catalog gates which IDs are selectable.
    isModernModelRef: ({ modelId }: { modelId: string }) =>
      typeof modelId === "string" && modelId.length > 0,
  };
}

export async function listGoogleAntigravityCatalog(
  ctx: UnifiedModelCatalogProviderContext,
): Promise<readonly UnifiedModelCatalogEntry[] | null> {
  if (shouldSkipLiveFetch(ctx.env ?? process.env)) return null;

  const live = await getLiveAntigravityModels({
    timeoutMs: ctx.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS,
    signal: ctx.signal,
  });

  if (!live) return null;

  const timestamps = { fetchedAt: live.fetchedAt, expiresAt: live.expiresAt };
  return live.models.map((model) =>
    toCatalogEntry(GOOGLE_ANTIGRAVITY_PROVIDER_ID, model, live.source, timestamps),
  );
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  name: "Google Antigravity CLI Provider",
  description: "Persistent agent turns through a local Google Antigravity agy CLI",
  register(api: OpenClawPluginApi) {
    api.registerProvider(buildGoogleAntigravityProvider("google-antigravity-cli"));
    api.registerCliBackend(buildGoogleAntigravityCliBackend("google-antigravity-cli"));
    api.registerModelCatalogProvider({
      provider: "google-antigravity-cli",
      kinds: ["text"],
      staticCatalog: () =>
        buildModelCatalogRows("google-antigravity-cli", "static", STATIC_MODEL_FALLBACK),
      liveCatalog: listGoogleAntigravityCatalog,
    });
    // Surfaces existing agy conversations (read-only) in the OpenClaw
    // sidebar. Continues resume via `agy --conversation <id>` through
    // the CLI backend registered above.
    registerAntigravitySessionCatalog(api);
  },
});

export { clearAntigravityModelsCache };
export default plugin;
