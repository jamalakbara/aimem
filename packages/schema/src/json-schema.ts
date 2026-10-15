import { z } from "zod";
import { projectSchema } from "./project.js";
import { recordSchema } from "./record.js";

/**
 * JSON Schema (draft 2020-12) for records and project.yaml, generated from the Zod
 * schemas (03 §10). Cross-field rules (managed_by: external ⇒ source) are not expressed.
 */
export function exportJsonSchemas(): { record: object; project: object } {
  return {
    record: z.toJSONSchema(recordSchema, { unrepresentable: "any" }),
    project: z.toJSONSchema(projectSchema, { unrepresentable: "any" }),
  };
}
