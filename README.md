# Google Antigravity Provider for OpenClaw

Production-ready OpenClaw plugin for delegating persistent agent turns and model routing to a local signed-in Google Antigravity (`agy`) CLI. Compatible with OpenClaw 2026.8.x+.

## Features

- **Persistent Multi-turn Agent Sessions:** Full SQLite conversation caching and automatic resume binding across turns.
- **Dynamic Configurable Timeouts:** Automatically derives `--print-timeout` dynamically from `timeoutSeconds` or custom plugin settings (default: `30m0s`), preventing premature agent turn termination.
- **Image Input:** Gemini and Claude models accept images. OpenClaw stages attachments into the workspace and appends their paths to the prompt; `agy` opens them with its own `view_file` tool.
- **Full Model Support:** Gemini 3.8 Flash, Gemini 3.7 Flash, Gemini 3.6 Flash, Gemini 3.1 Pro (effort routed through OpenClaw's thinking-level slider → `agy --effort {low|medium|high}`), Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking), GPT-OSS 120B.
- **Synthetic Local Auth:** Seamlessly uses local signed-in `agy` credentials with zero expiring tokens or stored secrets in OpenClaw.
- **Sanitized Execution Environment:** Automatically isolates user data via `ANTIGRAVITY_USER_DATA_DIR` and scrubs conflicting ambient Google API keys.
- **Preflight Probing:** Validates local `agy` CLI health, executable availability, and required command-line flags on setup.
- **Prompt Caching:** Resuming by conversation id keeps Google's server-side cache warm across turns; `cache_read_tokens` is reported back to OpenClaw as `cacheRead` usage.

## Installation

### Local Plugin Directory (Recommended)

In your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/home/rev/projects/openclaw-google-antigravity-provider"
      ]
    },
    "entries": {
      "google-antigravity-cli": {
        "enabled": true
      }
    }
  }
}
```

## Configuration

Add the provider definition and runtime mapping in `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "google-antigravity-cli": {
        "baseUrl": "http://antigravity.local",
        "api": "google-generative-ai",
        "models": [
          { "id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash", "reasoning": true, "input": ["text", "image"] },
          { "id": "gemini-3.7-flash", "name": "Gemini 3.7 Flash", "reasoning": true, "input": ["text", "image"] },
          { "id": "gemini-3.6-flash", "name": "Gemini 3.6 Flash", "reasoning": true, "input": ["text", "image"] },
          { "id": "gemini-3.1-pro", "name": "Gemini 3.1 Pro", "reasoning": true, "input": ["text", "image"] },
          { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6 (Thinking)", "reasoning": true, "input": ["text", "image"] },
          { "id": "claude-opus-4-6-thinking", "name": "Claude Opus 4.6 (Thinking)", "reasoning": true, "input": ["text", "image"] },
          { "id": "gpt-oss-120b-medium", "name": "GPT-OSS 120B (Medium)", "reasoning": true, "input": ["text"] }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "timeoutSeconds": 1800,
      "models": {
        "google-antigravity-cli/*": {
          "agentRuntime": {
            "id": "google-antigravity-cli"
          }
        }
      },
      "cliBackends": {
        "google-antigravity-cli": {
          "stream": true
        }
      }
    }
  }
}
```

### Optional: Real-Time Thought & Text Streaming

To stream thinking and response deltas in real-time to the OpenClaw Web UI, enable `stream: true` under `agents.defaults.cliBackends.google-antigravity-cli`:

```json
{
  "agents": {
    "defaults": {
      "cliBackends": {
        "google-antigravity-cli": {
          "stream": true
        }
      }
    }
  }
}
```

## Model Routing & Effort

`agy models` publishes the Gemini families only as effort-baked rows
(`gemini-3.7-flash-high`, `-medium`, `-low`). The plugin collapses them to one
row per family and supplies the level at execution time, which means `--effort`
handling has to follow agy's rules exactly:

| Model | `--effort` |
| --- | --- |
| Collapsed Gemini base id (`gemini-3.7-flash`) | **Required.** agy refuses to run it bare: `--model gemini-3.7-flash requires --effort` |
| Effort-baked Gemini id (`gemini-3.8-flash-medium`) | Not sent — the level is already in the id |
| Claude (`claude-sonnet-4-6`, `claude-opus-4-6-thinking`) | Never sent. agy: `--effort is not supported for model "claude-sonnet-4-6"` |
| GPT-OSS (`gpt-oss-120b-medium`) | Never sent — the level is part of the id |

Slider mapping: `off`/`minimal`/`low` → `low`, `medium`/`adaptive` → `medium`,
`high`/`xhigh`/`max` → `high`. When the slider is **off or unset**, models that
require an effort get `low` rather than no flag at all.

Levels are also clamped to what a family actually offers. Gemini 3.1 Pro ships
only `low` and `high` (`gemini-3.1-pro has no "medium" effort`), so a `medium`
slider resolves to `low` there — ties break downward so a request is never
silently upgraded to a more expensive level.

Aliases that name an effort (`flash-high`, `pro-low`) resolve to the matching
effort-baked id, so the level you asked for survives instead of being handed
back to the slider. Bare aliases (`flash`, `pro`) stay on the base family.

## Image Input

Gemini and Claude models accept image attachments. GPT-OSS 120B does not and stays
text-only in the catalog.

`agy` has no image flag, and its `--input-format stream-json` channel rejects
non-text content blocks (`stream input content block type "image" is not
supported (only "text")`). So images travel as **file paths**: OpenClaw stages
each attachment into `<workspace>/.openclaw-cli-images/`, appends the absolute
paths to the prompt, and `agy` opens them with its own `view_file` tool.

That is why the backend sets `imagePathScope: "workspace"` and leaves `imageArg`
unset — the `temp` scope would put the files outside the directory `agy` is
allowed to read.

Requirements:

- The model row must declare `"input": ["text", "image"]`. OpenClaw drops
  attachments for any model whose `input` lacks `image`.
- No extra flags are needed; the paths ride along in the prompt.

## Prompt Caching

Caching is owned by Google and survives across separate `agy` invocations, so it
works with the way this plugin shells out once per turn. Measured against
`agy` 1.0.14:

| Turn | Invocation | `input_tokens` | `cache_read_tokens` |
| --- | --- | --- | --- |
| 1 | fresh conversation | 6,013 | 8,093 |
| 2 | `--conversation <id>` | 8,326 | 20,228 |
| 3 | `--conversation <id>` | 11,008 | 32,423 |
| — | fresh conversation | 6,011 | 8,093 |

A brand-new conversation already reads ~8k cached tokens (the shared system
prompt and tool definitions). Resuming by conversation id compounds the hit as
the conversation grows; starting fresh resets it to the baseline.

Nothing needs enabling. What protects the cache is **session binding**: if
`captureSessionId` cannot resolve a new conversation id, OpenClaw starts a fresh
conversation each turn and every turn pays the baseline instead of the
compounded rate. `cache_read_tokens` is surfaced to OpenClaw as `cacheRead`
usage on the terminal result event.

## OpenClaw Compatibility

`registerCliBackend` is **current**, not deprecated. It is still on
`OpenClawPluginApi` in 2026.9.x and the bundled `google` and `anthropic`
extensions register their own CLI backends. The manifest's top-level
`cliBackends[]` is itself the documented *replacement* for the deprecated
`activation.onAgentHarnesses` hint, and this plugin already uses it. The
`agents.defaults.cliBackends` config key in the example above is also still
valid.

One thing did change: the `openclaw/plugin-sdk/cli-backend` and
`plugin-sdk/provider-model-shared` subpaths stopped shipping type declarations
after 2026.7.1. Verified from the published tarballs:

| openclaw | `plugin-sdk/cli-backend.d.ts` |
| --- | --- |
| 2026.7.1 | present |
| 2026.8.1 | **absent** (`.js` only) |
| 2026.9.1 | **absent** (`.js` only) |

The runtime exports survive; the types now live only in a content-hashed
internal chunk with no stable import path, so `tsc` fails with TS7016 on those
imports. That means this plugin never actually compiled against its own declared
minimum of 2026.8.1 — it only built because the lockfile still pinned 2026.7.1.

`src/openclaw-cli-backend-shim.d.ts` declares structural equivalents to keep the
build green, the same approach `src/session-catalog.ts` already takes for the
gateway-protocol types. It is safe on 2026.8.x and 2026.9.x because neither
ships competing declarations. `ProviderPlugin` needs no shim — it is still
exported from `plugin-sdk/plugin-entry`. Delete the shim if a future release
re-publishes the subpath declarations.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
