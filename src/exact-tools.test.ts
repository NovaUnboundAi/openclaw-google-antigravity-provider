import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { EXACT_CAP_ENV, prepareExactToolExecution, restrictExecutionArgs, scopedMcpServer, validateExactCap } from "./exact-tools.ts";

const captured = {
  mcpServers: {
    openclaw: { url: "http://127.0.0.1:12345/mcp", headers: { Authorization: "Bearer test-only", "x-openclaw-cli-capture-key": "test-attempt" } },
    ambient: { command: "must-not-run" },
  },
};

describe("exact Antigravity tool cap", () => {
  it("rejects native or malformed caps instead of weakening them", () => {
    for (const value of [undefined, {}, { native: ["read"], openClaw: [] }, { native: [], openClaw: ["*"] }]) {
      expect(() => validateExactCap(value)).toThrow();
    }
    expect(validateExactCap({ native: [], openClaw: ["read", "read"] })).toEqual({ native: [], openClaw: ["read"] });
  });

  it("drops resumed authority and rejects alternate agent selection", () => {
    expect(restrictExecutionArgs(["--conversation", "old", "--dangerously-skip-permissions", "--print", "hello"]))
      .toEqual(["--print", "hello", "--disable-slash-commands"]);
    for (const flag of ["--agent", "-agent=other", "--add-dir", "-project", "--input-format", "--", "--mcp-config=other", "--plugins", "--hooks=other", "--resume", "--disable-slash-commands=false", "unexpected"]) {
      expect(() => restrictExecutionArgs([flag])).toThrow();
    }
  });

  it("preserves prompt values and only an explicitly matched wrapper prefix", () => {
    const args = ["/private/wrapper.js", "--print", "--agent is text here", "--model=model", "--sandbox"];
    expect(restrictExecutionArgs(args, args[0])).toEqual([...args, "--disable-slash-commands"]);
    expect(() => restrictExecutionArgs(args, "/different/wrapper.js")).toThrow();
  });

  it("copies only the host capture transport and requires bound headers", () => {
    expect(scopedMcpServer(captured, "unique")).toEqual({ name: "unique", serverUrl: captured.mcpServers.openclaw.url, headers: captured.mcpServers.openclaw.headers });
    for (const server of [
      { url: "https://example.com/mcp", headers: captured.mcpServers.openclaw.headers },
      { url: captured.mcpServers.openclaw.url, headers: { Authorization: "Bearer test-only" } },
      { url: captured.mcpServers.openclaw.url, headers: { ...captured.mcpServers.openclaw.headers, Authorization: "Bearer " } },
      { url: captured.mcpServers.openclaw.url, headers: { Authorization: "Bearer ${TOKEN}", "x-openclaw-cli-capture-key": "test" } },
    ]) expect(() => scopedMcpServer({ mcpServers: { openclaw: server } }, "unique")).toThrow();
  });

  it("stages an empty cap without reading ambient MCP settings", async () => {
    const prepared = await prepareExactToolExecution({ args: [], env: {
      [EXACT_CAP_ENV]: JSON.stringify({ native: [], openClaw: [] }),
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: "/must-not-read-ambient-settings.json",
    } });
    try {
      const root = prepared.args.at(-1)!;
      const name = prepared.args[prepared.args.indexOf("--agent") + 1]!;
      const raw = await fs.readFile(path.join(root, ".agents", "agents", `${name}.md`), "utf8");
      const agent = JSON.parse(raw.split("---\n")[1]!);
      expect(agent.tools).toEqual([]);
      expect(agent.mcpServers).toEqual([]);
      expect(agent.inheritMcp).toBe(false);
      expect(agent.plugins).toHaveLength(1);
    } finally { await prepared.cleanup(); }
  });

  it("materializes an isolated agent and removes its private transport on cleanup", async () => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "agy-cap-test-"));
    try {
      const settingsPath = path.join(fixture, "settings.json");
      await fs.writeFile(settingsPath, JSON.stringify(captured), { mode: 0o600 });
      const prepared = await prepareExactToolExecution({ args: ["--print", "test"], env: { ...process.env, [EXACT_CAP_ENV]: JSON.stringify({ native: [], openClaw: ["read"] }), GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath } });
      const root = prepared.args.at(-1)!;
      const agentName = prepared.args[prepared.args.indexOf("--agent") + 1]!;
      const agentPath = path.join(root, ".agents", "agents", `${agentName}.md`);
      const raw = await fs.readFile(agentPath, "utf8");
      expect(raw).toContain('"inheritCustomizations": false');
      expect(raw).toContain('"excludeDefaultComponents": true');
      expect(raw).not.toContain("must-not-run");
      expect((await fs.stat(root)).mode & 0o777).toBe(0o700);
      expect((await fs.stat(agentPath)).mode & 0o777).toBe(0o600);
      await prepared.cleanup();
      await expect(fs.stat(root)).rejects.toThrow();
    } finally { await fs.rm(fixture, { recursive: true, force: true }); }
  });
});

// Executable fixtures exercise the real wrapper spawn/exit/cleanup boundary.
// POSIX shebang launch is unavailable on Windows.
describe.skipIf(process.platform === "win32")("restricted wrapper without a CLI version gate", () => {
  it.each([0, 23])("runs a CLI without --version support once and preserves exit %i", async (exitCode) => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "agy-wrapper-test-"));
    let stagedRoot: string | undefined;
    try {
      const command = path.join(fixture, "agy.cjs");
      const capture = path.join(fixture, "calls.jsonl");
      await fs.writeFile(command, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.AGY_TEST_CAPTURE, JSON.stringify(args) + "\\n");
if (args.includes("--version")) process.exit(99);
const root = args.at(-1);
const name = args[args.indexOf("--agent") + 1];
const raw = fs.readFileSync(path.join(root, ".agents", "agents", name + ".md"), "utf8");
const agent = JSON.parse(raw.split("---\\n")[1]);
process.stdout.write(JSON.stringify({ args, agent }), () => process.exit(Number(process.env.AGY_TEST_EXIT)));
`, { mode: 0o700 });
      const wrapper = fileURLToPath(new URL("./agy-strip-wrapper.ts", import.meta.url));
      const result = await promisify(execFile)(process.execPath, [wrapper,
        "--conversation", "old", "--dangerously-skip-permissions", "--print", "test",
      ], { env: {
        ...process.env,
        OPENCLAW_ANTIGRAVITY_REAL_COMMAND: command,
        [EXACT_CAP_ENV]: JSON.stringify({ native: [], openClaw: [] }),
        AGY_TEST_CAPTURE: capture,
        AGY_TEST_EXIT: String(exitCode),
      } }).then((value) => ({ ...value, code: 0 }), (error) => error);
      expect(result.code).toBe(exitCode);
      const { args, agent } = JSON.parse(result.stdout);
      stagedRoot = args.at(-1);
      expect(args.slice(0, 3)).toEqual(["--print", "test", "--disable-slash-commands"]);
      expect(args).not.toContain("--conversation");
      expect(args).not.toContain("--dangerously-skip-permissions");
      expect(agent).toMatchObject({ tools: [], mcpServers: [], inheritMcp: false,
        inheritCustomizations: false, excludeDefaultComponents: true });
      expect(agent.plugins).toHaveLength(1);
      const calls = (await fs.readFile(capture, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(calls).toEqual([args]);
      await expect(fs.stat(stagedRoot!)).rejects.toThrow();
    } finally {
      if (stagedRoot) await fs.rm(stagedRoot, { recursive: true, force: true });
      await fs.rm(fixture, { recursive: true, force: true });
    }
  });
});
