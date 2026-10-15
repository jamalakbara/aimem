// Writes dist/record.schema.json and dist/project.schema.json from the built package (03 §10).
import { writeFileSync } from "node:fs";
import { exportJsonSchemas } from "../dist/index.js";

const { record, project } = exportJsonSchemas();
const out = new URL("../dist/", import.meta.url);
writeFileSync(new URL("record.schema.json", out), `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(new URL("project.schema.json", out), `${JSON.stringify(project, null, 2)}\n`);
