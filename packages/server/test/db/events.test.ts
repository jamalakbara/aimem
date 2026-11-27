import type { RunningServer } from "@aimem/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertInvariants,
  client,
  counts,
  freshDb,
  newTask,
  server,
  sleep,
  type TestDb,
  token,
} from "./helpers.js";

let db: TestDb;
let srv: RunningServer;
let failBeforeEvent: string | undefined;
let holdAtSeq: { task: string; reached: () => void; go: Promise<void> } | undefined;
// biome-ignore lint/suspicious/noExplicitAny: test clients
let dana: any, rina: any;
const lastSeq = async () =>
  Number(
    (
      await db.pool.query(
        "SELECT last_seq FROM project_event_seq p JOIN projects j ON j.id = p.project_id WHERE j.slug = 'alpha'",
      )
    ).rows[0].last_seq,
  );

beforeAll(async () => {
  db = await freshDb();
  srv = await server(db, {
    at: async (point, info) => {
      if (point === "beforeEvent" && info.task === failBeforeEvent)
        throw new Error("event write failed at /secret/path");
      if (point === "seq" && holdAtSeq && info.task === holdAtSeq.task) {
        holdAtSeq.reached();
        await holdAtSeq.go;
      }
    },
  });
  dana = client(srv.url, "alpha", await token(db.pool, "alpha", "dana"), "s-dana");
  rina = client(srv.url, "alpha", await token(db.pool, "alpha", "rina"), "s-rina");
});
afterAll(async () => {
  await assertInvariants(db.pool);
  await srv.close();
  await db.drop();
});

describe("events are written with the change, or not at all (EV-0)", () => {
  it("a failing event write rolls back the claim and the audit, and leaves no gap", async () => {
    await dana.acquire({ task: newTask() });
    const before = await counts(db.pool);
    const seq = await lastSeq();
    const task = newTask();
    failBeforeEvent = `alpha:${task}`;
    const r = await dana.acquire({ task });
    failBeforeEvent = undefined;
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({ code: "SYNC_FAILED" });
    expect(r.text).not.toMatch(/secret|path|Error/);
    expect(await counts(db.pool)).toEqual(before);
    expect(await lastSeq()).toBe(seq);
    const ok = await dana.acquire({ task });
    expect(ok.status).toBe(201);
    const ev = await db.pool.query("SELECT seq FROM events WHERE payload->'claim'->>'task' = $1", [
      `alpha:${task}`,
    ]);
    expect(Number(ev.rows[0].seq)).toBe(seq + 1);
  });

  it("also when the database itself refuses the event", async () => {
    await db.pool.query(`CREATE FUNCTION refuse_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.payload->'claim'->>'note' = 'fail-me' THEN RAISE EXCEPTION 'refused'; END IF; RETURN NEW; END $$`);
    await db.pool.query(
      "CREATE TRIGGER refuse_event BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION refuse_event()",
    );
    try {
      const before = await counts(db.pool);
      const seq = await lastSeq();
      const r = await dana.acquire({ task: newTask(), note: "fail-me" });
      expect(r.status).toBe(500);
      expect(await counts(db.pool)).toEqual(before);
      expect(await lastSeq()).toBe(seq);
    } finally {
      await db.pool.query("DROP TRIGGER refuse_event ON events");
    }
  });
});

describe("event numbers follow commit order (EV-1-db) and GET live has a matching cursor", () => {
  it("a later transaction in the same project cannot commit or show before an earlier one", async () => {
    const x = newTask();
    const y = newTask();
    const before = await lastSeq();
    let reached!: () => void;
    const atSeq = new Promise<void>((d) => {
      reached = d;
    });
    let go!: () => void;
    holdAtSeq = {
      task: `alpha:${x}`,
      reached,
      go: new Promise<void>((d) => {
        go = d;
      }),
    };
    const px = dana.acquire({ task: x });
    await atSeq;
    let yDone = false;
    const py = rina.acquire({ task: y }).then((r: unknown) => {
      yDone = true;
      return r;
    });
    await sleep(800);
    expect(yDone).toBe(false);
    const visible = await db.pool.query(
      "SELECT count(*)::int AS n FROM events e JOIN projects p ON p.id = e.project_id WHERE p.slug = 'alpha' AND e.seq > $1",
      [before],
    );
    expect(visible.rows[0].n).toBe(0);
    const live = await rina.live();
    expect(live.json.cursor).toBe(before);
    expect(live.json.claims.map((c: { task: string }) => c.task)).not.toContain(`alpha:${y}`);
    go();
    holdAtSeq = undefined;
    const [rx, ry] = await Promise.all([px, py]);
    expect([rx.status, ry.status]).toEqual([201, 201]);
    const seqs = await db.pool.query(
      "SELECT payload->'claim'->>'task' AS task, seq FROM events WHERE seq > $1 AND project_id = (SELECT id FROM projects WHERE slug = 'alpha') ORDER BY seq",
      [before],
    );
    expect(seqs.rows.map((r) => [r.task, Number(r.seq)])).toEqual([
      [`alpha:${x}`, before + 1],
      [`alpha:${y}`, before + 2],
    ]);
    expect((await rina.live()).json.cursor).toBe(before + 2);
  });

  it("every change up to the cursor is in the claims of the same answer", async () => {
    const tasks = Array.from({ length: 40 }, () => newTask());
    const lives: Promise<{ json: { cursor: number; claims: { task: string }[] } }>[] = [];
    const writes = tasks.map((t, i) => (i % 2 ? dana : rina).acquire({ task: t }));
    for (let i = 0; i < 30; i++) {
      lives.push(dana.live());
      await sleep(5);
    }
    await Promise.all(writes);
    for (const l of await Promise.all(lives)) {
      const { cursor, claims } = l.json;
      const created = await db.pool.query(
        `SELECT payload->'claim'->>'task' AS task FROM events
          WHERE project_id = (SELECT id FROM projects WHERE slug = 'alpha') AND seq <= $1 AND type = 'claim.created'
            AND payload->'claim'->>'task' = ANY($2)`,
        [cursor, tasks.map((t) => `alpha:${t}`)],
      );
      const shown = new Set(claims.map((c) => c.task).filter((t) => tasks.some((x) => `alpha:${x}` === t)));
      expect(shown).toEqual(new Set(created.rows.map((r) => r.task)));
    }
  });
});
