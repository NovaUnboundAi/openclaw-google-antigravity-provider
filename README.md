# Google Antigravity Provider for OpenClaw

Production-ready OpenClaw plugin for delegating persistent agent turns and model routing to a local signed-in Google Antigravity (`agy`) CLI. Compatible with OpenClaw 2026.8.x+.

## Features

- **Persistent Multi-turn Agent Sessions:** Full SQLite conversation caching and automatic resume binding across turns.
- **Dynamic Configurable Timeouts:** Automatically derives `--print-timeout` dynamically from `timeoutSeconds` or custom plugin settings (default: `30m0s`), preventing premature agent turn termination.
- **Full Model Support:** Gemini 3.8 Flash (High / Medium / Low), Gemini 3.7 Flash (High / Medium / Low), Gemini 3.6 Flash (High / Medium / Low), Gemini 3.1 Pro (High / Low), Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking), GPT-OSS 120B.
- **Synthetic Local Auth:** Seamlessly uses local signed-in `agy` credentials with zero expiring tokens or stored secrets in OpenClaw.
- **Sanitized Execution Environment:** Automatically isolates user data via `ANTIGRAVITY_USER_DATA_DIR` and scrubs conflicting ambient Google API keys.
- **Preflight Probing:** Validates local `agy` CLI health, executable availability, and required command-line flags on setup.

## Installation

### Prerequisites

1. Install the Google Antigravity `agy` CLI for the Gateway host.
2. Sign in through `agy` as the same operating-system user that runs the
   OpenClaw Gateway.
3. Confirm `agy --help` lists `--print`, `--model`, and `--print-timeout`.

### Local Plugin Directory (Recommended)

Clone the repository, then add its directory to `~/.openclaw/openclaw.json`.
OpenClaw loads the TypeScript entrypoint directly; a separate dependency install
or build step is not required.

```json
{
  "plugins": {
    "allow": [
      "google-antigravity-cli"
    ],
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

For a local path install, `plugins.allow` is required for OpenClaw to trust the
provider-discovery entry used by chat-channel model pickers. If the array is
already present, preserve its existing entries and add
`google-antigravity-cli`; do not replace the array.

## Configuration

The plugin registers its model catalog, synthetic local authentication, and CLI
runtime routing. Do not add a hand-written
`models.providers.google-antigravity-cli` block or per-model runtime mappings.

Run the provider login once as the Gateway operating-system user. This checks
the local `agy` installation and stores only a non-secret local-runtime marker;
it does not copy Google credentials into OpenClaw.

```bash
openclaw models auth login --provider google-antigravity-cli --method custom
```

If `agents.defaults.modelPolicy.allow` is already configured, preserve that
policy. The provider-login command preserves its existing entries and adds the
plugin's exact model references. This is necessary because an explicit
allowlist is an operator security boundary and the plugin will not bypass it.
Rerun the provider-login command after an update that adds models so an existing
exact allowlist receives the new references.

After installing or updating the plugin, reload the Gateway through your normal
OpenClaw service workflow. Then verify the picker directly with:

```text
/models google-antigravity-cli
```

### What users do not need to configure

- No `npm install` or `npm run build` for normal local-plugin use.
- No `models.providers.google-antigravity-cli` block.
- No `agents.defaults.models` runtime mapping for each Antigravity model.
- No stored Google API key or copied Antigravity OAuth token in OpenClaw.

If the provider appears in `openclaw models list` but not `/models`, first check
the active agent's `modelPolicy.allow`, confirm the Gateway service user can run
`agy --help`, and verify the loaded source with
`openclaw plugins inspect google-antigravity-cli`.

### Real-Time Thought & Text Streaming

The backend always uses `stream-json`/`jsonl` so it can stream output and retain
Antigravity conversation IDs for persistent sessions.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
