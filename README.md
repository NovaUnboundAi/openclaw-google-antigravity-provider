# Google Antigravity Provider for OpenClaw

Production-ready OpenClaw plugin for delegating persistent agent turns and model routing to a local signed-in Google Antigravity (`agy`) CLI. Compatible with OpenClaw 2026.8.x+.

## Features

- **Persistent Multi-turn Agent Sessions:** Full SQLite conversation caching and automatic resume binding across turns.
- **Dynamic Configurable Timeouts:** Automatically derives `--print-timeout` dynamically from `timeoutSeconds` or custom plugin settings (default: `30m0s`), preventing premature agent turn termination.
- **Image Input:** Gemini and Claude models accept images. OpenClaw stages attachments into the workspace and appends their paths to the prompt; `agy` opens them with its own `view_file` tool.
- **Full Model Support:** Gemini 3.8 Flash, Gemini 3.7 Flash, Gemini 3.6 Flash, Gemini 3.1 Pro (effort routed through OpenClaw's thinking-level slider → `agy --effort {low|medium|high}`), Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking), GPT-OSS 120B.
- **Synthetic Local Auth:** Seamlessly uses local signed-in `agy` credentials with zero expiring tokens or stored secrets in OpenClaw.
- **Sanitized Execution Environment:** Automatically isolates user data via `ANTIGRAVITY_USER_DATA_DIR` and scrubs conflicting ambient Google API keys.
- **Workspace Instructions:** Reads the same bootstrap files OpenClaw does (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `BOOTSTRAP.md`, `MEMORY.md`) per agent, and delivers them to agy once per conversation, so agents behave the same here as on any other provider.
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

### Tool Permissions

agy cannot prompt for a tool permission in headless `--print` mode — it
auto-denies and reports that the tool *"required the read_file permission that
headless mode cannot prompt for"* — so a policy has to be chosen up front.
`permissionMode` under the plugin's config selects it:

| Mode | Flag | Behaviour |
| --- | --- | --- |
| `skip` (default) | `--dangerously-skip-permissions` | Auto-approves every tool. The only mode that works with no further setup. |
| `sandbox` | `--sandbox` | agy runs with terminal restrictions enabled. |
| `settings` | *(neither)* | Defers to `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`. Least privileged, but needs a rule for every tool you expect to be used. |

```json
{
  "plugins": {
    "entries": {
      "google-antigravity-cli": {
        "enabled": true,
        "config": { "permissionMode": "sandbox" }
      }
    }
  }
}
```

The default stays `skip` for compatibility and because it is the only mode that
runs unattended out of the box — but it does mean every agy tool call is
auto-approved. Pick `sandbox` or `settings` if that is not acceptable.

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

## Cross-Provider Continuity

A chat can move between providers — start on OpenRouter in Telegram, switch to
an agy model, switch away again. The three cases behave like this:

| Situation | What OpenClaw does | What the plugin adds |
| --- | --- | --- |
| First switch **to** an agy model | No binding exists, so it reseeds the transcript into the prompt | Nothing — injecting would duplicate the reseed |
| Consecutive agy turns | Resumes `agy --conversation <id>`, sends only the new message | Nothing — agy already has the history |
| Switch **back** to agy after turns elsewhere | Reuses the stored binding and sends only the new message | Injects the turns agy missed |

That third row is the gap this plugin closes. OpenClaw keeps CLI session
bindings per provider (`entry.cliSessionBindings[providerId]`) and clears them
only on failure, never on a model or provider switch.
`resolveCliSessionReuse` decides reuse from auth profile, auth epoch,
message-tool policy, cwd, MCP, and system-prompt/tool hashes — none of which is
a transcript position — and `CliSessionBinding` carries no cursor. The runner
then does:

```js
basePrompt = cliSessionIdToUse ? prompt : openClawHistoryPrompt ?? prompt
```

So without help, a resumed agy conversation silently misses everything that
happened while another provider was answering.

The fix is a `before_prompt_build` hook, which runs on the CLI path with the
session transcript and whose `prependContext` is folded into the outgoing
prompt. Every `AssistantMessage` records the `provider` that produced it, so
the missed turns are simply everything after this provider's most recent
assistant message. That makes the delta **stateless** — no watermark to persist
or drift out of sync — and it self-corrects: if a turn is ever missed, the next
one still computes the gap from the same anchor.

Finding no prior agy assistant turn is exactly the first-switch-in case, so the
hook stays silent there and lets OpenClaw's own reseed do the work. Missed turns
are rendered as `User:` / `Assistant:` lines inside a `<turns_you_missed>`
block, capped at 8,000 chars, dropping oldest-first and saying how many turns it
omitted. Tool traffic is left out, since agy has its own tool history and
replaying another runtime's tool calls is noise.

### Compaction

The backend declares `ownsNativeCompaction` but deliberately offers **no**
manual compaction operation, matching the bundled `google-gemini-cli` backend.
agy has no compaction command — its slash-command surface is `/agents`,
`/changelog`, `/config`, `/credits`, `/effort`, `/help`, `/hooks`, `/model`,
`/permissions`, `/skills`, `/usage`, and `/compact` is answered as ordinary
chat. A control operation that merely asked the model to *"summarise this
conversation"* would **append** a summary turn rather than shrink anything,
while reporting success to OpenClaw. `/compact` therefore fails loudly instead
of silently doing nothing.

### Workspace Instructions

OpenClaw agents get their behaviour from workspace bootstrap files, and by
default none of them reached agy, so an agy turn answered as stock Antigravity
instead of as your agent. The plugin now reads the same files OpenClaw does —
`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, in that order —
and hands them to agy in the prompt.

`BOOTSTRAP.md` is deliberately **excluded**. OpenClaw drives it as a dedicated
one-time run (*"read BOOTSTRAP.md from the workspace now and follow it before
replying normally"*) and the file is deleted once bootstrap completes. Shipping
it as standing instructions would invite agy to re-run a bootstrap procedure on
ordinary turns.

Measured against agy 1.0.14, with an `AGENTS.md` saying *"always answer in
exactly one sentence"* and a `SOUL.md` saying *"you are Ada, dry and precise"*:

| | Reply to "Who are you, and what is 2+2?" |
| --- | --- |
| Without the block | "I am Gemini 3.7 Flash, an AI assistant built by Google (operating as Antigravity here…)" — several sentences |
| With the block | "I am Ada, and the sum of 2 and 2 is 4." |

**Multi-agent aware.** The files are read from `ctx.workspaceDir`, which
OpenClaw resolves per run, so each agent gets its own workspace rather than a
shared one. Delivery is tracked per agent *and* workspace, so two agents in one
gateway never consume each other's state.

**Sent once per agy conversation, not per turn.** Delivery is keyed on the agy
conversation id bound to the workspace *and* a fingerprint of the instructions
on disk, so the block goes out when a conversation is first created and then
stays quiet. It is sent again when either changes:

- the conversation id differs — the binding was lost or replaced, and the new
  conversation has never seen the instructions;
- the fingerprint differs — a file was edited, added, or deleted, so the live
  conversation is carrying a stale copy.

Restarting the gateway clears the in-memory tracker, which costs one extra
delivery and nothing else.

Budget is 16,000 chars (6,000 on Windows, where the whole command line is capped
near 32,767). Earlier files win, since OpenClaw's ordering puts operating
instructions ahead of persona and `MEMORY.md` last, so truncation drops the most
incidental content first and the block names anything it omitted.

Why this is needed rather than using OpenClaw's own system prompt:
`resolveWorkspaceBootstrapRouting` is skipped unless the backend can transport a
system prompt, and `canTransportSystemPrompt` requires `systemPromptArg`,
`systemPromptFileArg`, or `systemPromptFileConfigKey`. agy has no
system-prompt flag for any of them to point at, and it does not read an
`AGENTS.md` from the working directory on its own (verified).

### Known limits

- **The first switch-in is truncated.** OpenClaw's reseed budget for this
  backend is `12288 - 89 = 12,199` chars (the larger context-derived budget is
  `claude-cli`-only), so a long prior chat reaches agy as a truncated tail. That
  budget is OpenClaw's and is not plugin-configurable.
- **OpenClaw's assembled system prompt still does not reach agy**, only the
  workspace files above. There is no flag to transport it, and with
  `nativeToolMode: "always-on"` agy owns its own tool surface, so OpenClaw's
  tool and channel instructions would describe tools agy does not have.
  Workspace instructions are the part that defines agent behaviour, and those
  now arrive.

## Platform Notes

The plugin runs on the same machine as `agy`, so paths and process limits are
resolved with platform-native APIs: `fileURLToPath` for workspace URIs (which
yields `C:\\Users\\...` and `\\\\server\\share` on Windows rather than
`/C:/Users/...`), `path.normalize` for cache keys, and `where` instead of
`which` when probing for the binary. The conversation-cache lookup also matches
case-insensitively on Windows and macOS, since agy and OpenClaw can spell the
same directory differently there. That match is not cosmetic — missing it makes
`captureSessionId` throw, which drops the session binding, restarts the agy
conversation every turn, and discards the accumulated prompt cache.

The data directory defaults to `~/.gemini/antigravity-cli`, resolved through
`$HOME` and falling back to `os.homedir()` when `HOME` is unset, as it usually
is on Windows.

### Prompt size limit

Prompts reach `agy --print` as a **command-line argument**, so the OS argv
limit is a hard ceiling:

| Platform | Limit | Notes |
| --- | --- | --- |
| Windows | ~32,767 chars for the whole command line | `CreateProcess`; the tightest |
| macOS | 262,144 bytes for args + environment | `ARG_MAX` |
| Linux | 131,072 bytes per single argument | `MAX_ARG_STRLEN`; measured |

The prompt is **not** always just the newest message. OpenClaw sends only the
new message when it has a CLI session id to resume
(`basePrompt = cliSessionIdToUse ? prompt : openClawHistoryPrompt ?? prompt`).
With no session id it reseeds, embedding the prior transcript in a
`<conversation_history>` block ahead of `<next_user_message>`.

That reseed is bounded. The context-derived budget that can reach 262,144 chars
applies only when the backend id is literally `claude-cli`, so this backend
falls back to the default `MAX_CLI_SESSION_RESEED_HISTORY_CHARS`, giving
`12288 - 89 = 12,199` chars of history. Worst case is therefore ~12.2 KB of
reseed plus the current message — comfortably inside every platform limit,
leaving roughly 20 KB of headroom for a single message on Windows, and far more
elsewhere.

So the reachable failure is one unusually large **single message** (a pasted log
or file dump) on Windows. It fails loudly, before agy starts, with
`spawn E2BIG` / `Argument list too long`.

Keeping the session binding healthy matters here too: without it every turn
takes the reseed path instead of the cheaper resume path, which both enlarges
the prompt and discards the accumulated prompt cache.

**Do not set `maxPromptArgChars`.** It is the obvious mitigation and it is
wrong twice over. First, when OpenClaw diverts a long prompt to stdin it leaves
`promptArg` undefined, and it only substitutes the `{prompt}` placeholder when
that value is defined — so agy would receive the literal string `{prompt}`.
Second, agy's stdin path is *worse* than argv: it accepts a prompt on stdin when
`--print` is omitted, but measured against agy 1.0.14 it processes 16,384 chars
and **silently discards** anything from ~20,000 up, returning
`status: SUCCESS` with an empty response and zero token usage. A loud E2BIG is
strictly preferable to a silent empty turn, so argv remains the correct
transport.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
