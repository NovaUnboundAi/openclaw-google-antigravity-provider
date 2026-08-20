import {
  definePluginEntry,
  type OpenClawPluginApi,
  type OpenClawPluginDefinition,
  type ProviderAuthContext,
  type ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";
import type { ProviderPlugin } from "openclaw/plugin-sdk/provider-model-shared";
import {
  buildGoogleAntigravityCliBackend,
  GOOGLE_ANTIGRAVITY_DEFAULT_MODEL_REF,
  GOOGLE_ANTIGRAVITY_PROVIDER_ID,
} from "./backend.js";
import { probeAgy, type AgyProbeResult } from "./probe.js";

export const GOOGLE_ANTIGRAVITY_AUTH_MARKER = "antigravity-local-session";

export const MODEL_DEFINITIONS = [
  {
    id: "gemini-3.7-flash-high",
    name: "Gemini 3.7 Flash (High)",
    reasoning: true,
  },
  {
    id: "gemini-3.7-flash-medium",
    name: "Gemini 3.7 Flash (Medium)",
    reasoning: true,
  },
  {
    id: "gemini-3.7-flash-low",
    name: "Gemini 3.7 Flash (Low)",
    reasoning: true,
  },
  {
    id: "gemini-3.6-flash-high",
    name: "Gemini 3.6 Flash (High)",
    reasoning: true,
  },
  {
    id: "gemini-3.6-flash-medium",
    name: "Gemini 3.6 Flash (Medium)",
    reasoning: true,
  },
  {
    id: "gemini-3.6-flash-low",
    name: "Gemini 3.6 Flash (Low)",
    reasoning: true,
  },
  {
    id: "gemini-3.5-flash-high",
    name: "Gemini 3.5 Flash (High)",
    reasoning: true,
  },
  {
    id: "gemini-3.5-flash-medium",
    name: "Gemini 3.5 Flash (Medium)",
    reasoning: false,
  },
  {
    id: "gemini-3.5-flash-low",
    name: "Gemini 3.5 Flash (Low)",
    reasoning: false,
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    reasoning: false,
  },
  {
    id: "gemini-3.1-pro-high",
    name: "Gemini 3.1 Pro (High)",
    reasoning: true,
  },
  {
    id: "gemini-3.1-pro-low",
    name: "Gemini 3.1 Pro (Low)",
    reasoning: true,
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6 (Thinking)",
    reasoning: true,
  },
  {
    id: "claude-opus-4.6",
    name: "Claude Opus 4.6 (Thinking)",
    reasoning: true,
  },
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B (Medium)",
    reasoning: true,
  },
] as const;

function buildRuntimeModel(providerId: string, modelId: string): ProviderRuntimeModel | undefined {
  const definition = MODEL_DEFINITIONS.find((model) => model.id === modelId);
  if (!definition) return undefined;
  return {
    id: definition.id,
    name: definition.name,
    provider: providerId,
    api: "google-generative-ai",
    baseUrl: "https://antigravity.invalid",
    reasoning: definition.reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  };
}

function buildAntigravityConfigPatch(providerId = GOOGLE_ANTIGRAVITY_PROVIDER_ID) {
  const models: Record<string, any> = {};
  for (const model of MODEL_DEFINITIONS) {
    models[`${providerId}/${model.id}`] = {
      agentRuntime: { id: providerId },
    };
  }
  return { agents: { defaults: { models } } };
}

export function buildModelCatalogRows(providerId: string, source: "static" | "live" = "static") {
  return MODEL_DEFINITIONS.map((model) => ({
    kind: "text" as const,
    provider: providerId,
    model: model.id,
    label: model.name,
    source,
    capabilities: {
      reasoning: model.reasoning,
      input: ["text"],
      contextWindow: 1_000_000,
    },
  }));
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
            configPatch: buildAntigravityConfigPatch(providerId),
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
    resolveDynamicModel: ({ modelId }) => buildRuntimeModel(providerId, modelId),
    augmentModelCatalog: () =>
      MODEL_DEFINITIONS.map((model) => ({
        provider: providerId,
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: ["text"],
        contextWindow: 1_000_000,
      })),
    isModernModelRef: ({ modelId }) =>
      MODEL_DEFINITIONS.some((model) => model.id === modelId),
  };
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
      staticCatalog: () => buildModelCatalogRows("google-antigravity-cli", "static"),
      liveCatalog: () => buildModelCatalogRows("google-antigravity-cli", "live"),
    });
  },
});

export default plugin;
