import dgram from "node:dgram";
import dns from "node:dns";
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

it("UDP and dns.resolve are refused too", async () => {
  const s = dgram.createSocket("udp4");
  expect(() => s.send("x", 53, "192.0.2.1")).toThrow(/must not use the network/);
  s.close();
  expect(() => dns.resolve4("example.invalid", () => undefined)).toThrow(/must not use the network/);
  await expect(dns.promises.resolve4("example.invalid")).rejects.toThrow(/must not use the network/);
});
