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
          { "id": "gemini-3.8-flash-high", "name": "Gemini 3.8 Flash (High)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.8-flash-medium", "name": "Gemini 3.8 Flash (Medium)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.8-flash-low", "name": "Gemini 3.8 Flash (Low)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.7-flash-medium", "name": "Gemini 3.7 Flash (Medium)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.7-flash-high", "name": "Gemini 3.7 Flash (High)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.7-flash-low", "name": "Gemini 3.7 Flash (Low)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.6-flash-high", "name": "Gemini 3.6 Flash (High)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.6-flash-medium", "name": "Gemini 3.6 Flash (Medium)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.6-flash-low", "name": "Gemini 3.6 Flash (Low)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.1-pro-high", "name": "Gemini 3.1 Pro (High)", "reasoning": true, "input": ["text"] },
          { "id": "gemini-3.1-pro-low", "name": "Gemini 3.1 Pro (Low)", "reasoning": true, "input": ["text"] },
          { "id": "claude-sonnet-4.6", "name": "Claude Sonnet 4.6 (Thinking)", "reasoning": true, "input": ["text"] },
          { "id": "claude-opus-4.6", "name": "Claude Opus 4.6 (Thinking)", "reasoning": true, "input": ["text"] },
          { "id": "gpt-oss-120b", "name": "GPT-OSS 120B (Medium)", "reasoning": true, "input": ["text"] }
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

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
