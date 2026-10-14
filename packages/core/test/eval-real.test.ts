import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildVectorCache,
  createLocalProvider,
  type EvalSet,
  loadIndex,
  loadProject,
  nodeFs,
  runEvalSet,
} from "@aimem/core";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { FIXTURES, fixedRandom } from "./helpers.js";

/**
 * M2 gate with the real default model (docs/13 M2, 12 §3). Opt-in: AIMEM_REAL_MODEL=1 (downloads the
 * model once into $AIMEM_HOME/models or ~/.cache/aimem/models). Runs in the nightly/manual eval workflow.
 */
describe.runIf(process.env.AIMEM_REAL_MODEL === "1")("M2 gate with the default local model", () => {
  it("hybrid beats lexical on paraphrase and multilingual, keeps keyword, overall ≥ 0.85", async () => {
    const root = mkdtempSync(join(tmpdir(), "aimem-real-"));
    try {
      cpSync(join(FIXTURES, "medium"), root, { recursive: true });
      const nb = await loadProject(nodeFs, root);
      const index = await loadIndex(nb, { fs: nodeFs });
      const set = YAML.parse(
        readFileSync(new URL("../../../fixtures/evals/medium.yaml", import.meta.url), "utf8"),
      ) as EvalSet;
      const cacheDir = join(process.env.AIMEM_HOME ?? join(homedir(), ".cache", "aimem"), "models");
      const provider = await createLocalProvider({ model: "auto", cacheDir, allowDownload: true });
      await buildVectorCache(nb, index, provider, { fs: nodeFs, random: fixedRandom(1) });
      const lexical = await runEvalSet(nb, index, set);
      const hybrid = await runEvalSet(nb, index, set, { provider, fs: nodeFs });
      const cat = (r: typeof lexical, c: string) => r.byCategory[c]?.recall ?? 0;
      expect(cat(hybrid, "paraphrase")).toBeGreaterThan(cat(lexical, "paraphrase"));
      expect(cat(hybrid, "multilingual")).toBeGreaterThan(cat(lexical, "multilingual"));
      expect(cat(hybrid, "keyword")).toBeGreaterThanOrEqual(cat(lexical, "keyword"));
      expect(hybrid.overall.recall).toBeGreaterThanOrEqual(0.85);
      expect(hybrid.overall).toMatchObject({ violations: 0, budgetOk: 1, deterministic: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 600_000);
});
