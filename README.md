# Google Antigravity Provider for OpenClaw

Production-ready OpenClaw plugin for delegating persistent agent turns and model routing to a local signed-in Google Antigravity (`agy`) CLI.

## Features

- **Persistent Multi-turn Agent Sessions:** Full SQLite conversation caching and automatic resume binding across turns.
- **Dynamic Configurable Timeouts:** Automatically derives `--print-timeout` dynamically from `timeoutSeconds` or custom plugin settings (default: `30m0s`), preventing premature agent turn termination.
- **Full Model Support:** Gemini 3.5 Flash / High / Low, Gemini 3.1 Pro High / Low, Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking), GPT-OSS 120B.
- **Sanitized Execution Environment:** Automatically isolates user data via `ANTIGRAVITY_USER_DATA_DIR` and scrubs conflicting ambient Google API keys.
- **Preflight Probing:** Validates local `agy` CLI health, executable availability, and required command-line flags on setup.

## Installation

### Method 1: Local Plugin Directory (Recommended)

In your `openclaw.json`:

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

### Method 2: Packaged Plugin Install

```bash
openclaw plugins install /home/rev/projects/openclaw-google-antigravity-provider
```

## Configuration

Add the provider and model routes in `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "timeoutSeconds": 1800,
      "models": {
        "google-antigravity-cli/*": {
          "params": {
            "timeoutSeconds": 1800,
            "noOutputTimeoutMs": 600000
          }
        }
      },
      "cliBackends": {
        "google-antigravity-cli": {
          "command": "agy",
          "printTimeout": "30m0s",
          "reliability": {
            "watchdog": {
              "fresh": { "noOutputTimeoutMs": 1800000 },
              "resume": { "noOutputTimeoutMs": 1800000 }
            }
          }
        }
      }
    }
  },
  "diagnostics": {
    "stuckSessionWarnMs": 600000,
    "stuckSessionAbortMs": 1800000
  }
}
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
