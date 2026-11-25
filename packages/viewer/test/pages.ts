import { fileURLToPath } from "node:url";
import {
  type IndexedRecord,
  loadProject,
  loadProjectIndex,
  nodeFs,
  type ProjectIndex,
  sourceWarnings,
} from "@aimem/core";
import { parse, type DefaultTreeAdapterTypes as T } from "parse5";
import type { ViewContext } from "../src/view.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/projects/${name}`, import.meta.url));

export async function context(name: string, over: Partial<ViewContext> = {}): Promise<ViewContext> {
  const nb = await loadProject(nodeFs, fixture(name));
  const index = await loadProjectIndex(nb, { fs: nodeFs });
  return {
    nb,
    index,
    problems: index.problems,
    warnings: sourceWarnings(index),
    now: new Date("2026-11-24T00:00:00Z"),
    ...over,
  };
}

/** The fixture with some records replaced or added. */
export function withRecords(ctx: ViewContext, ...records: IndexedRecord[]): ViewContext {
  const index: ProjectIndex = { ...ctx.index, records: [...ctx.index.records, ...records] };
  return { ...ctx, index };
}

export function record(over: Partial<IndexedRecord> = {}): IndexedRecord {
  const base = {
    id: "mem-zzzzzzzz",
    type: "memory" as const,
    status: "active",
    trust: "verified",
    title: "Title",
    summary: "Summary",
    tags: [],
    roles: ["all"],
    paths: [],
    links: [],
    author: "human:dana",
    created: "2026-11-01T00:00:00Z",
    updated: "2026-11-02T00:00:00Z",
    fm: {},
    body: "Body text.",
    file: ".aimem/memory/mem-zzzzzzzz-title.md",
    text: "RAW FILE TEXT",
  };
  return { ...base, ...over } as IndexedRecord;
}

export const nodeText = (n: T.Node): string =>
  n.nodeName === "#text" && "value" in n
    ? n.value
    : "childNodes" in n
      ? n.childNodes.map(nodeText).join("")
      : "";
/** Elements below a node, in document order. */
export function within(root: T.Node, test: (e: T.Element) => boolean): T.Element[] {
  const out: T.Element[] = [];
  const walk = (n: T.Node): void => {
    if ("tagName" in n && test(n)) out.push(n);
    if ("childNodes" in n) for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}
export const find = (html: string, test: (e: T.Element) => boolean): T.Element[] => within(parse(html), test);
export const texts = (html: string, tag: string) =>
  find(html, (e) => e.tagName === tag).map((e) => nodeText(e).trim());
export const attr = (e: T.Element | undefined, name: string) => e?.attrs.find((a) => a.name === name)?.value;
export const all = (html: string) =>
  find(html, (e) => e.tagName === "main")
    .map(nodeText)
    .join(" ")
    .replace(/\s+/g, " ");

/** A card of a list: an `li` that names its record. */
export const isCard = (e: T.Element) => e.tagName === "li" && attr(e, "data-ref") !== undefined;
export const cardsOf = (root: T.Node): T.Element[] => within(root, isCard);
export const refsOf = (root: T.Node): string[] => cardsOf(root).map((e) => attr(e, "data-ref") ?? "");
