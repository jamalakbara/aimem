import { join } from "node:path";
import YAML, { isScalar, visit } from "yaml";
import type { Fs, Random } from "../ports.js";
import { writeFileAtomic } from "../records/store.js";
import type { Notebook } from "./load.js";

/**
 * Set a value in `.aimem/project.yaml`, keeping comments and other keys; lists of scalars are
 * written in flow style (`[a, b]`) like `aimem init` does. Writes atomically.
 */
export async function setProjectValue(
  fs: Fs,
  nb: Notebook,
  path: string[],
  value: unknown,
  random: Random,
): Promise<void> {
  const file = join(nb.dir, "project.yaml");
  const doc = YAML.parseDocument(await fs.readFile(file));
  const node = doc.createNode(value);
  visit(node, {
    Seq(_, seq) {
      if (seq.items.every((i) => isScalar(i))) seq.flow = true;
    },
  });
  doc.setIn(path, node);
  await writeFileAtomic(fs, file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), random);
}
