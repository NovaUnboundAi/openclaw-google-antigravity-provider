#!/usr/bin/env node
// Thin wrapper that OpenClaw spawns instead of raw `agy`.
//
// OpenClaw's cli-runner composes the turn prompt (`--print <text>`) with the
// channel-provided context block prepended, and it does so AFTER every
// registered `before_prompt_build` hook has already returned — so a plugin
// hook cannot rewrite that prompt. When the backend has native session
// persistence (agy stores the whole conversation in its own SQLite and
// resumes via `--conversation <id>`), the channel context is redundant: agy
// already knows the history. Sending it every turn compounds the SQLite
// state and blows past the model's context window.
//
// This wrapper receives the full argv OpenClaw built, strips the
// openclaw:ctx blocks (and the Active goal appendix) from the `--print`
// value, and execs the real `agy` binary with the trimmed argv. Everything
// else (stdio streaming, exit code, signal handling) is inherited directly
// so OpenClaw's stream-json parser and cancellation still work.

import { spawn } from "node:child_process";
import { stripArgvChannelContext } from "./prompt-strip.js";

function resolveRealAgy(env: NodeJS.ProcessEnv): string {
  return env.OPENCLAW_ANTIGRAVITY_REAL_COMMAND?.trim() || "agy";
}

const args = stripArgvChannelContext(process.argv.slice(2));
const command = resolveRealAgy(process.env);

const child = spawn(command, args, {
  stdio: "inherit",
  env: process.env,
});

const forward = (signal: NodeJS.Signals) => {
  if (!child.killed) child.kill(signal);
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => forward(signal));
}

child.on("error", (err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `google-antigravity-cli wrapper: failed to spawn "${command}": ${message}\n`,
  );
  process.exit(127);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
