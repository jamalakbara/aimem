import { join } from "node:path";
import {
  AimemError,
  discardRecord,
  loadIndex,
  loadProject,
  type ReviewItem,
  resolveAuthorWithGit,
  reviewQueue,
  verifyRecords,
} from "@aimem/core";
import type { CliDeps, CommandResult, GlobalOptions } from "../deps.js";
import { writeDeps } from "./embedder.js";

const who = (deps: CliDeps, g: GlobalOptions, o: { author?: string }) =>
  resolveAuthorWithGit({ ...(o.author ? { flag: o.author } : {}), env: deps.env, git: deps.git, cwd: g.dir });

const line = (i: ReviewItem) => `${i.ref}  ${i.type}  ${i.status}  ${i.trust}  ${i.title}`;
const QUESTION = "(v)erify  (e)dit+verify  (s)kip  (d)iscard  (q)uit: ";

/**
 * `aimem review` (04, 08 §2.1 Phase D, 22 §4.5): the records that need a person — inferred drafts,
 * unreviewed agent records, stale records. `--json` or no terminal: list only. On a terminal: walk
 * the queue. Verifying and discarding stay human-only; an agent can only skip.
 */
export async function review(
  deps: CliDeps,
  g: GlobalOptions,
  o: { json?: boolean; author?: string; limit?: number },
): Promise<CommandResult> {
  const nb = await loadProject(deps.fs, g.dir);
  const all = reviewQueue(nb, await loadIndex(nb, { fs: deps.fs }), deps.clock.now());
  const queue = o.limit ? all.slice(0, o.limit) : all;
  const counts = {
    inferred: all.filter((i) => i.reasons.includes("inferred")).length,
    unreviewed: all.filter((i) => i.reasons.includes("unreviewed")).length,
    stale: all.filter((i) => i.reasons.includes("stale")).length,
    duplicate: all.filter((i) => i.reasons.includes("duplicate")).length,
  };
  if (o.json || !deps.prompt || !queue.length) {
    const text = queue.length
      ? [
          `${all.length} record${all.length === 1 ? " needs" : "s need"} review${queue.length < all.length ? ` (showing ${queue.length}; --limit)` : ""}:`,
          ...queue.map(
            (i) => `  ${line(i)}  (${i.reasons.join(", ")}${i.duplicateOf ? ` of ${i.duplicateOf}` : ""})`,
          ),
          "",
          "Review them on a terminal with aimem review, or one by one: aimem show <ref>, then aimem verify <ref> or aimem discard <ref>.",
        ].join("\n")
      : "Nothing to review.";
    return { data: { queue, counts, total: all.length }, text: `${text}\n` };
  }

  const author = await who(deps, g, o);
  const done = { verified: 0, discarded: 0, skipped: 0 };
  let seen = 0;
  const say = (s: string) => deps.stdout(`${s}\n`);
  const tryDo = async (f: () => Promise<unknown>) => {
    try {
      await f();
      return true;
    } catch (e) {
      if (!(e instanceof AimemError)) throw e;
      say(`  ${e.message}`);
      return false;
    }
  };
  for (const [n, item] of queue.entries()) {
    say(`\n[${n + 1}/${queue.length}] ${line(item)}`);
    say(`  ${item.file}`);
    if (item.evidence) say(`  evidence: ${item.evidence.join(", ")}`);
    say(`  ${item.summary}`);
    say(
      `  needs review: ${item.reasons.join(", ")}${item.duplicateOf ? ` (looks like ${item.duplicateOf})` : ""}`,
    );
    let answer: string | undefined;
    for (;;) {
      answer = (await deps.prompt(QUESTION))?.trim().toLowerCase();
      if (answer === undefined || ["v", "e", "s", "d", "q"].includes(answer)) break;
      say(`  unknown answer '${answer}'; use v, e, s, d or q`);
    }
    if (answer === undefined || answer === "q") break;
    seen++;
    const wdeps = await writeDeps(deps, nb);
    if (answer === "v" || answer === "e") {
      if (answer === "e") {
        if (!deps.edit) {
          say("  no editor available here; skipped");
          done.skipped++;
          continue;
        }
        if (!author.startsWith("human:")) {
          say(`  only a human can verify records; ask a person on the team to run aimem verify ${item.ref}`);
          done.skipped++;
          continue;
        }
        const path = join(nb.root, item.file);
        const original = await deps.fs.readFile(path);
        try {
          await deps.edit(path);
        } catch (e) {
          say(`  editor failed (${e instanceof Error ? e.message : String(e)}); not verified`);
          done.skipped++;
          continue;
        }
        // An edit that breaks the front matter must not leave a corrupt file behind.
        const after = await loadIndex(nb, { fs: deps.fs });
        if (!after.records.some((r) => r.id === item.ref && r.file === item.file)) {
          await deps.fs.writeFile(path, original);
          say("  the edit left an invalid record; restored the original, not verified");
          done.skipped++;
          continue;
        }
      }
      if (await tryDo(() => verifyRecords(nb, [item.ref], author, wdeps))) {
        say(`  verified ${item.ref}`);
        done.verified++;
      } else done.skipped++;
    } else if (answer === "d") {
      if (await tryDo(() => discardRecord(nb, item.ref, author, wdeps))) {
        say(`  discarded ${item.ref}`);
        done.discarded++;
      } else done.skipped++;
    } else done.skipped++;
  }
  return {
    data: { queue, counts, total: all.length, reviewed: seen, ...done },
    text: `\nReviewed ${seen} of ${queue.length}: ${done.verified} verified, ${done.discarded} discarded, ${done.skipped} skipped.\n`,
  };
}

/** `aimem discard <ref>` (04): delete a never-verified record nothing links to. Humans only. */
export async function discard(
  deps: CliDeps,
  g: GlobalOptions,
  ref: string,
  o: { author?: string },
): Promise<CommandResult> {
  const author = await who(deps, g, o);
  const nb = await loadProject(deps.fs, g.dir);
  const r = await discardRecord(nb, ref, author, await writeDeps(deps, nb));
  return {
    data: { ref: r.ref, file: r.file, changed: r.changed, git: "none" },
    text: `Discarded ${r.ref} (${r.file}). Commit the deletion with your next change.\n`,
    warnings: r.warnings,
  };
}
