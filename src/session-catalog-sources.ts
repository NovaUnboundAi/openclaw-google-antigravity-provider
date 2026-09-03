import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { iterProtobufTextFields } from "./session-catalog-protobuf.js";

export type AntigravityConversationSummary = {
  readonly conversationId: string;
  readonly title: string;
  readonly preview: string;
  readonly stepCount: number;
  readonly lastModifiedMs?: number;
  readonly lastUserInputMs?: number;
  readonly workspaceUris: readonly string[];
  readonly status: string;
  readonly appDataDir: string;
  readonly killed: boolean;
};

export type AntigravityTranscriptItem = {
  readonly kind: "userMessage" | "agentMessage" | "toolCall" | "other";
  readonly text: string;
  readonly timestampMs?: number;
  readonly stepIndex?: number;
  readonly toolName?: string;
};

function parseSqliteDatetime(raw: unknown): number | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

function parseWorkspaceUris(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const trimmed = raw.trim();
  // The column is a JSON array most of the time, occasionally a bare string.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
    }
    if (typeof parsed === "string" && parsed.length > 0) return [parsed];
  } catch {
    if (trimmed.startsWith("file://")) return [trimmed];
  }
  return [];
}

// Open the shared conversation_summaries.db read-only and return every row
// as a normalized summary. This is the sidebar's data source.
export function readAntigravityConversationSummaries(
  dataDir: string,
): AntigravityConversationSummary[] {
  const summariesPath = path.join(dataDir, "conversation_summaries.db");
  if (!fs.existsSync(summariesPath)) return [];
  const db = new DatabaseSync(summariesPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `
        SELECT
          conversation_id, title, preview, step_count,
          last_modified_time, last_user_input_time,
          workspace_uris, status, app_data_dir, killed
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
      `,
      )
      .all() as ReadonlyArray<Record<string, unknown>>;
    const out: AntigravityConversationSummary[] = [];
    for (const row of rows) {
      const conversationId =
        typeof row.conversation_id === "string" ? row.conversation_id.trim() : "";
      if (!conversationId) continue;
      out.push({
        conversationId,
        title: typeof row.title === "string" ? row.title : "",
        preview: typeof row.preview === "string" ? row.preview : "",
        stepCount: typeof row.step_count === "number" ? row.step_count : 0,
        lastModifiedMs: parseSqliteDatetime(row.last_modified_time),
        lastUserInputMs: parseSqliteDatetime(row.last_user_input_time),
        workspaceUris: parseWorkspaceUris(row.workspace_uris),
        status: typeof row.status === "string" ? row.status : "",
        appDataDir: typeof row.app_data_dir === "string" ? row.app_data_dir : "",
        killed: Boolean(row.killed),
      });
    }
    return out;
  } finally {
    db.close();
  }
}

export function conversationSummaryLabel(summary: AntigravityConversationSummary): string {
  const cleanTitle = summary.title.trim();
  if (cleanTitle) return cleanTitle;
  const previewFirstLine = summary.preview.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const stripped = previewFirstLine.replace(/^Conversation Title:\s*/i, "").trim();
  if (stripped) return stripped;
  return summary.conversationId.slice(0, 8);
}

export function summaryPrimaryCwd(
  summary: AntigravityConversationSummary,
): string | undefined {
  const first = summary.workspaceUris[0];
  if (!first) return undefined;
  try {
    if (first.startsWith("file://")) {
      const url = new URL(first);
      return decodeURIComponent(url.pathname);
    }
  } catch {}
  return first;
}

// history.jsonl carries the clean human-typed prompt for every turn. The
// per-conversation `.db` step blobs only encode assistant/tool activity in
// their opaque protobuf, so the user's original message is best sourced
// from this file. Each JSONL row is
//   {"display": "<text>", "timestamp": <ms>, "workspace": "<path>",
//    "conversationId"?: "<uuid>"}.
// Older rows omit conversationId; those are matched to the "root" of a
// workspace and skipped here.
type HistoryPrompt = {
  readonly conversationId: string;
  readonly text: string;
  readonly timestampMs?: number;
};

async function readHistoryFile(historyPath: string): Promise<HistoryPrompt[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(historyPath, "utf8");
  } catch {
    return [];
  }
  const out: HistoryPrompt[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("{")) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record || typeof record !== "object") continue;
    const conversationId =
      typeof record.conversationId === "string" ? record.conversationId.trim() : "";
    const display = typeof record.display === "string" ? record.display : "";
    if (!conversationId || !display) continue;
    const timestamp =
      typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
        ? record.timestamp
        : undefined;
    out.push({ conversationId, text: display, ...(timestamp ? { timestampMs: timestamp } : {}) });
  }
  return out;
}

export type StepBlobKind = "step_payload" | "render_info" | "metadata";

export type StepBlobText = {
  readonly stepIndex: number;
  readonly kind: StepBlobKind;
  readonly text: string;
};

function walkStepBlob(blob: Uint8Array, kind: StepBlobKind, stepIndex: number): StepBlobText[] {
  const seen = new Set<string>();
  const out: StepBlobText[] = [];
  for (const text of iterProtobufTextFields(blob, { minLength: 16 })) {
    const normalized = text.trim();
    if (!normalized || seen.has(normalized)) continue;
    // Reject strings that are obviously binary artefacts: pure hex,
    // long base64, or UUID-only.
    if (/^[0-9a-fA-F-]{32,}$/.test(normalized)) continue;
    seen.add(normalized);
    out.push({ stepIndex, kind, text: normalized });
  }
  return out;
}

// Best-effort transcript reconstruction. Combines the user prompts from
// history.jsonl with the schemaless protobuf text extraction of the
// conversation's step BLOBs, ordered by step index. Returned items are
// suitable for a `SessionsCatalogReadResult.items[]` array.
export async function readAntigravityConversationTranscript(params: {
  readonly dataDir: string;
  readonly conversationId: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}): Promise<AntigravityTranscriptItem[]> {
  const { dataDir, conversationId, limit, signal } = params;
  const dbPath = path.join(dataDir, "conversations", `${conversationId}.db`);
  const historyPath = path.join(dataDir, "history.jsonl");

  const userPrompts = (await readHistoryFile(historyPath)).filter(
    (row) => row.conversationId === conversationId,
  );

  const stepItems: AntigravityTranscriptItem[] = [];
  if (fs.existsSync(dbPath)) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          `SELECT idx, step_payload, render_info, metadata
           FROM steps
           ORDER BY idx ASC`,
        )
        .all() as ReadonlyArray<Record<string, unknown>>;
      for (const row of rows) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const idx = typeof row.idx === "number" ? row.idx : 0;
        const payload = row.step_payload instanceof Uint8Array ? row.step_payload : undefined;
        const render = row.render_info instanceof Uint8Array ? row.render_info : undefined;
        const meta = row.metadata instanceof Uint8Array ? row.metadata : undefined;
        for (const source of [
          { blob: payload, kind: "step_payload" as const },
          { blob: render, kind: "render_info" as const },
          { blob: meta, kind: "metadata" as const },
        ]) {
          if (!source.blob) continue;
          for (const item of walkStepBlob(source.blob, source.kind, idx)) {
            stepItems.push({
              kind: guessKindFromText(item.text, item.kind),
              text: item.text,
              stepIndex: item.stepIndex,
            });
          }
        }
      }
    } finally {
      db.close();
    }
  }

  const merged: AntigravityTranscriptItem[] = [];
  let promptCursor = 0;
  const promptsSorted = userPrompts
    .slice()
    .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));

  // Interleave prompts with step-extracted text by step index. We don't
  // know which step a prompt belongs to, so distribute prompts evenly
  // across the step range, oldest first.
  const stepIndexes = [...new Set(stepItems.map((item) => item.stepIndex ?? 0))].sort(
    (a, b) => a - b,
  );
  const promptsPerBucket = Math.max(1, Math.ceil(promptsSorted.length / Math.max(stepIndexes.length, 1)));

  for (const idx of stepIndexes) {
    for (let i = 0; i < promptsPerBucket && promptCursor < promptsSorted.length; i++) {
      const prompt = promptsSorted[promptCursor];
      promptCursor += 1;
      if (!prompt) break;
      merged.push({
        kind: "userMessage",
        text: prompt.text,
        timestampMs: prompt.timestampMs,
        stepIndex: idx,
      });
    }
    for (const item of stepItems.filter((v) => v.stepIndex === idx)) {
      merged.push(item);
    }
  }
  // Any remaining prompts (rare): append at the end.
  while (promptCursor < promptsSorted.length) {
    const prompt = promptsSorted[promptCursor];
    promptCursor += 1;
    if (!prompt) break;
    merged.push({
      kind: "userMessage",
      text: prompt.text,
      timestampMs: prompt.timestampMs,
    });
  }

  return typeof limit === "number" ? merged.slice(0, limit) : merged;
}

function guessKindFromText(text: string, blobKind: StepBlobKind): AntigravityTranscriptItem["kind"] {
  if (blobKind === "metadata") return "other";
  // Rough heuristics: JSON-shaped payloads are tool call args; long prose is
  // likely assistant output.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "toolCall";
  return "agentMessage";
}
