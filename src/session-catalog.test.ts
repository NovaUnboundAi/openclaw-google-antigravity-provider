import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAntigravitySessionCatalog,
  conversationIdFromSessionKey,
  isAntigravitySessionKey,
  sessionKeyForConversation,
} from "./session-catalog.js";

function makeTempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-catalog-test-"));
}

function seedSummariesDb(
  dataDir: string,
  rows: ReadonlyArray<{
    conversationId: string;
    title?: string;
    preview?: string;
    stepCount?: number;
    workspaceUris?: string[];
    lastModified?: string;
    lastUserInput?: string;
    status?: string;
    killed?: boolean;
    appDataDir?: string;
  }>,
) {
  const dbPath = path.join(dataDir, "conversation_summaries.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT "",
      preview TEXT NOT NULL DEFAULT "",
      step_count INTEGER NOT NULL DEFAULT 0,
      last_modified_time DATETIME NOT NULL,
      workspace_uris TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT "",
      source TEXT NOT NULL DEFAULT "",
      project_id TEXT NOT NULL DEFAULT "",
      agent_name TEXT NOT NULL DEFAULT "",
      parent_conversation_id TEXT NOT NULL DEFAULT "",
      nesting_depth INTEGER NOT NULL DEFAULT 0,
      battle_id TEXT NOT NULL DEFAULT "",
      winning_conversation_id TEXT NOT NULL DEFAULT "",
      not_fully_idle NUMERIC NOT NULL DEFAULT false,
      killed NUMERIC NOT NULL DEFAULT false,
      last_user_input_time DATETIME NOT NULL,
      last_user_input_step_index INTEGER NOT NULL DEFAULT -1,
      app_data_dir TEXT NOT NULL DEFAULT ""
    )
  `);
  const stmt = db.prepare(
    `INSERT INTO conversation_summaries (
        conversation_id, title, preview, step_count,
        last_modified_time, workspace_uris, status,
        killed, last_user_input_time, app_data_dir
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    stmt.run(
      row.conversationId,
      row.title ?? "",
      row.preview ?? "",
      row.stepCount ?? 0,
      row.lastModified ?? "2026-09-01T00:00:00Z",
      JSON.stringify(row.workspaceUris ?? []),
      row.status ?? "",
      row.killed ? 1 : 0,
      row.lastUserInput ?? row.lastModified ?? "2026-09-01T00:00:00Z",
      row.appDataDir ?? "antigravity-cli",
    );
  }
  db.close();
}

async function seedHistory(
  dataDir: string,
  rows: ReadonlyArray<{ conversationId: string; display: string; timestamp: number }>,
) {
  const historyPath = path.join(dataDir, "history.jsonl");
  const lines = rows
    .map((row) =>
      JSON.stringify({
        display: row.display,
        timestamp: row.timestamp,
        workspace: "/tmp",
        conversationId: row.conversationId,
      }),
    )
    .join("\n");
  await fsp.writeFile(historyPath, lines + "\n", "utf8");
}

describe("session key helpers", () => {
  it("round-trips", () => {
    const id = "1712cb0a-9d94-4bd0-9db5-99f95702ba9f";
    const key = sessionKeyForConversation(id);
    expect(isAntigravitySessionKey(key)).toBe(true);
    expect(conversationIdFromSessionKey(key)).toBe(id);
  });

  it("rejects unrelated keys", () => {
    expect(isAntigravitySessionKey("harness:codex:abc")).toBe(false);
    expect(conversationIdFromSessionKey("harness:codex:abc")).toBeUndefined();
  });
});

describe("SessionCatalogProvider list()", () => {
  let dataDir = "";
  beforeEach(() => {
    dataDir = makeTempDataDir();
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns an empty local host with sessions:[] when the data dir has no summaries", async () => {
    const provider = buildAntigravitySessionCatalog({ dataDir });
    const hosts = await provider.list({});
    expect(hosts).toHaveLength(1);
    expect(hosts[0]?.hostId).toBe("google-antigravity-cli-local");
    expect(hosts[0]?.sessions).toEqual([]);
  });

  it("surfaces conversations sorted by most-recent modification", async () => {
    seedSummariesDb(dataDir, [
      {
        conversationId: "1111",
        title: "Alpha task",
        stepCount: 3,
        workspaceUris: ["file:///tmp/alpha"],
        lastModified: "2026-09-01T10:00:00Z",
      },
      {
        conversationId: "2222",
        title: "",
        preview: "Conversation Title: Beta task",
        stepCount: 12,
        workspaceUris: ["file:///tmp/beta"],
        lastModified: "2026-09-04T10:00:00Z",
      },
    ]);
    const provider = buildAntigravitySessionCatalog({ dataDir });
    const hosts = await provider.list({});
    const sessions = hosts[0]?.sessions ?? [];
    expect(sessions.map((s) => s.threadId)).toEqual(["2222", "1111"]);
    expect(sessions[0]?.name).toBe("Beta task");
    expect(sessions[0]?.cwd).toBe("/tmp/beta");
    expect(sessions[0]?.canContinue).toBe(true);
    expect(sessions[0]?.archived).toBe(false);
  });

  it("filters by search substring across title, preview, id, workspace", async () => {
    seedSummariesDb(dataDir, [
      { conversationId: "abcd1234", title: "Fix Telegram bug" },
      { conversationId: "efgh5678", title: "Unrelated" },
    ]);
    const provider = buildAntigravitySessionCatalog({ dataDir });
    const hosts = await provider.list({ search: "telegram" });
    expect(hosts[0]?.sessions.map((s) => s.threadId)).toEqual(["abcd1234"]);
  });
});

describe("SessionCatalogProvider read()", () => {
  let dataDir = "";
  beforeEach(() => {
    dataDir = makeTempDataDir();
    fs.mkdirSync(path.join(dataDir, "conversations"), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns an empty transcript when the conversation db is missing", async () => {
    const provider = buildAntigravitySessionCatalog({ dataDir });
    const result = await provider.read({ threadId: "does-not-exist", hostId: "google-antigravity-cli-local" });
    expect(result.threadId).toBe("does-not-exist");
    expect(result.items).toEqual([]);
  });

  it("surfaces user prompts from history.jsonl even without a step db", async () => {
    await seedHistory(dataDir, [
      { conversationId: "abcd", display: "Please summarize this repo carefully.", timestamp: 1_000 },
      { conversationId: "abcd", display: "Now add a follow-up test and rerun.", timestamp: 2_000 },
      { conversationId: "other", display: "Ignore me.", timestamp: 3_000 },
    ]);
    const provider = buildAntigravitySessionCatalog({ dataDir });
    const result = await provider.read({ threadId: "abcd", hostId: "google-antigravity-cli-local" });
    const userTexts = result.items
      .filter((item) => item.type === "userMessage")
      .map((item) => item.text);
    expect(userTexts).toEqual([
      "Please summarize this repo carefully.",
      "Now add a follow-up test and rerun.",
    ]);
  });
});

describe("SessionCatalogProvider copyToGatewaySession()", () => {
  let dataDir = "";
  beforeEach(() => {
    dataDir = makeTempDataDir();
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns the conversation label as displayName when the summary exists", async () => {
    seedSummariesDb(dataDir, [
      { conversationId: "abcd1234", title: "Rebuild release pipeline" },
    ]);
    const provider = buildAntigravitySessionCatalog({ dataDir });
    const result = await (provider as any).copyToGatewaySession({
      threadId: "abcd1234",
      hostId: "google-antigravity-cli-local",
    });
    expect(result).toEqual({ displayName: "Rebuild release pipeline" });
  });

  it("returns an empty hint when no summary is on disk", async () => {
    const provider = buildAntigravitySessionCatalog({ dataDir });
    const result = await (provider as any).copyToGatewaySession({
      threadId: "unknown-conversation",
      hostId: "google-antigravity-cli-local",
    });
    expect(result).toEqual({});
  });

  it("rejects an empty conversation id", async () => {
    const provider = buildAntigravitySessionCatalog({ dataDir });
    await expect(
      (provider as any).copyToGatewaySession({ threadId: "", hostId: "google-antigravity-cli-local" }),
    ).rejects.toThrow(/conversation id/);
  });
});

describe("SessionCatalogProvider continueSession()", () => {
  it("returns a session key bound to the conversation id", async () => {
    const provider = buildAntigravitySessionCatalog({ dataDir: "/tmp/does-not-matter" });
    const result = await provider.continueSession!({
      threadId: "9277298e-cc25-4e13-a4bf-a98358aeef34",
      hostId: "google-antigravity-cli-local",
    });
    expect(result.sessionKey).toBe(
      "harness:google-antigravity-cli:9277298e-cc25-4e13-a4bf-a98358aeef34",
    );
    expect(result.conversationBinding?.data).toBeDefined();
  });

  it("rejects an empty conversation id", async () => {
    const provider = buildAntigravitySessionCatalog({ dataDir: "/tmp/does-not-matter" });
    await expect(
      provider.continueSession!({ threadId: "", hostId: "google-antigravity-cli-local" }),
    ).rejects.toThrow(/conversation id/);
  });
});
