import { exportJsonSchemas, RECORD_TYPES, STATUSES } from "@aimem/schema";
import { describe, expect, it } from "vitest";

const REQUIRED = [
  "aimem",
  "id",
  "type",
  "title",
  "summary",
  "status",
  "trust",
  "roles",
  "author",
  "created",
  "updated",
];

type Obj = { properties?: Record<string, { const?: string; enum?: string[] }>; required?: string[] };

describe("JSON Schema export (03 §10)", () => {
  const { record, project } = exportJsonSchemas();

  it("record schema has one branch per type with that type's statuses and the common required fields", () => {
    const branches =
      (record as { anyOf?: Obj[]; oneOf?: Obj[] }).anyOf ?? (record as { oneOf?: Obj[] }).oneOf ?? [];
    expect(branches).toHaveLength(RECORD_TYPES.length);
    for (const b of branches) {
      const type = b.properties?.type?.const as (typeof RECORD_TYPES)[number];
      expect(RECORD_TYPES).toContain(type);
      expect(b.properties?.status?.enum).toEqual([...STATUSES[type]]);
      for (const f of REQUIRED) expect(b.required).toContain(f);
    }
  });

  it("project schema requires aimem and project", () => {
    expect((project as Obj).required).toEqual(["aimem", "project"]);
  });

  it("export is stable (contract snapshot)", () => {
    expect({ record, project }).toMatchSnapshot();
  });
});
