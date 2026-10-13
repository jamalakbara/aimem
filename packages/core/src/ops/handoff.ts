import { AimemError } from "../errors.js";
import { loadIndex } from "../index/build.js";
import type { Notebook } from "../project/load.js";
import { addRecord, type WriteDeps } from "./write.js";

export interface HandoffInput {
  done: string;
  notDone: string;
  next: string;
  blocked?: string;
  notes?: string;
  task?: string;
  branch?: string;
  session?: string;
  author: string;
  roles?: string[];
}

export type HandoffSections = Partial<Pick<HandoffInput, "done" | "notDone" | "next" | "blocked" | "notes">>;

const SECTION_KEYS: Record<string, keyof HandoffSections> = {
  done: "done",
  "not done": "notDone",
  next: "next",
  blocked: "blocked",
  "notes for next agent": "notes",
};

/** Read `## Done` … `## Notes for next agent` sections from markdown (for `--from-file`). */
export function parseHandoffFile(text: string): HandoffSections {
  const out: HandoffSections = {};
  let current: keyof HandoffSections | undefined;
  let lines: string[] = [];
  const flush = () => {
    if (current) out[current] = lines.join("\n").trim();
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      current = SECTION_KEYS[(h[1] ?? "").toLowerCase()];
      lines = [];
    } else if (current) lines.push(line);
  }
  flush();
  return out;
}

/** First meaningful line, without a leading list marker. */
const firstLine = (s: string) =>
  (s.split("\n").find((l) => l.trim()) ?? "").replace(/^\s*[-*+]\s+/, "").trim();
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** `aimem handoff` (04 §4): a dated, immutable handoff record with all five sections (03 §3.4). */
export async function addHandoff(nb: Notebook, input: HandoffInput, deps: WriteDeps) {
  for (const [name, value] of [
    ["Done", input.done],
    ["Not done", input.notDone],
    ["Next", input.next],
  ] as const) {
    if (!value?.trim()) throw new AimemError("INVALID_RECORD", `handoff needs a non-empty "${name}" section`);
  }
  if (input.task) {
    const index = await loadIndex(nb, { fs: deps.fs });
    const id = input.task.includes(":") ? input.task.split(":")[1] : input.task;
    const task = index.records.find((r) => r.id === id);
    if (!task) throw new AimemError("NOT_FOUND", `task ${input.task} not found`);
    if (task.type !== "task")
      throw new AimemError("INVALID_RECORD", `${input.task} is a ${task.type}, not a task`);
  }
  const today = deps.clock.now().toISOString().slice(0, 10);
  const body = [
    ["Done", input.done],
    ["Not done", input.notDone],
    ["Next", input.next],
    ["Blocked", input.blocked],
    ["Notes for next agent", input.notes],
  ]
    .map(([h, t]) => `## ${h}\n${t?.trim() || "none"}`)
    .join("\n\n");
  return addRecord(
    nb,
    {
      type: "handoff",
      title: cut(`Handoff ${today}: ${firstLine(input.done)}`, 120),
      summary: cut(`Done: ${firstLine(input.done)} · Next: ${firstLine(input.next)}`, 200),
      body,
      author: input.author,
      ...(input.roles?.length ? { roles: input.roles } : {}),
      fields: {
        ...(input.task ? { task: input.task } : {}),
        ...(input.session ? { session: input.session } : {}),
        ...(input.branch ? { branch: input.branch } : {}),
      },
    },
    deps,
  );
}
