import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseGoogleAntigravityJsonlEvent } from "./backend.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function runWrapper(diagnostic: string, exitCode: number, pauseOutput = false, pauseStderr = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agy-wrapper-test-"));
  roots.push(root);
  const fakeAgy = path.join(root, "agy.mjs");
  await fs.writeFile(fakeAgy, `
    process.stdout.write(JSON.stringify({ event: "step_update", step_update: {
      step_type: "agent_response", text_delta: "partial answer"
    }}) + "\\n");
    process.stderr.write(${JSON.stringify(diagnostic)}, () => { process.exitCode = ${exitCode}; });
  `);
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL("./agy-strip-wrapper.ts", import.meta.url)), fakeAgy,
    ], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        OPENCLAW_ANTIGRAVITY_REAL_COMMAND: process.execPath,
        OPENCLAW_ANTIGRAVITY_EXPOSE_TOOLS: "false",
        ANTIGRAVITY_USER_DATA_DIR: path.join(root, "profile"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (pauseOutput) {
      child.stdout.pause();
      setTimeout(() => child.stdout.resume(), 150);
    }
    if (pauseStderr) {
      child.stderr.pause();
      setTimeout(() => child.stderr.resume(), 150);
    }
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("agy wrapper subprocess boundary", () => {
  it.each([
    ['AGY_ERROR: {"message":"quota exceeded","http_code":429}', 3, "quota exceeded"],
    ["[agy] print timeout after 1s; returning partial output", 0, "--print-timeout expired"],
  ])("surfaces a terminal marker after partial stdout: %s", async (diagnostic, code, expected) => {
    const result = await runWrapper(diagnostic, code);
    expect(result.code).toBe(code);
    expect(result.stderr).toBe(diagnostic);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).step_update.text_delta).toBe("partial answer");
    const parsed = parseGoogleAntigravityJsonlEvent(lines[1]!, {
      backendId: "google-antigravity-cli", backend: { command: process.execPath },
    });
    expect(parsed).toEqual({ kind: "result", errorText: expect.stringContaining(expected) });
  });

  it.each([false, true])("flushes diagnostics with a slow stderr reader (terminal error: %s)", async (terminalError) => {
    const prefix = terminalError ? 'AGY_ERROR: {"message":"backend failed"}\n' : "";
    const diagnostic = prefix + "x".repeat(1024 * 1024) + "\n";
    const result = await runWrapper(diagnostic, terminalError ? 3 : 0, false, true);
    expect(result.code).toBe(terminalError ? 3 : 0);
    expect(result.stderr).toBe(diagnostic);
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toHaveLength(terminalError ? 2 : 1);
    if (terminalError) expect(events.at(-1)!.result.error).toBe("backend failed");
  });

  it("flushes a large synthetic error before exiting with a slow stdout consumer", async () => {
    const message = "backend failure ".repeat(32768);
    const result = await runWrapper(`AGY_ERROR: ${JSON.stringify({ message })}\n`, 3, true);
    expect(result.code).toBe(3);
    const finalLine = result.stdout.trim().split("\n").at(-1)!;
    expect(JSON.parse(finalLine).result.error).toBe(message.trim());
  });
});
