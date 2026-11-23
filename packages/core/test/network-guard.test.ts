import { createServer } from "node:http";
import { expect, it } from "vitest";

it("tests cannot reach the network, but can reach their own local server", async () => {
  const err = await fetch("https://example.invalid/").catch(
    (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ""}`,
  );
  expect(String(err)).toMatch(/tests must not use the network/);
  const server = createServer((_q, r) => r.end("ok"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("ok");
  server.close();
});
