import dgram from "node:dgram";
import dns from "node:dns";
import { Socket } from "node:net";

/**
 * Connectors run on simulated responses, so a test that reaches for the network is a mistake (QA plan 16).
 * This catches mistakes in the test process itself: TCP, UDP and dns.resolve to anything that is not local.
 * It is not a sandbox: worker threads and child processes (git, the built CLI) are not covered.
 */
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "::"]);
const connect = Socket.prototype.connect;
Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
  // net.connect passes normalised arguments as one array: [options, callback].
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const opts = (typeof first === "object" && first !== null ? first : {}) as { host?: string; path?: string };
  const host = opts.host ?? (typeof first === "number" && typeof args[1] === "string" ? args[1] : undefined);
  if (!opts.path && host !== undefined && !LOCAL.has(host))
    throw new Error(`tests must not use the network (tried to reach ${host})`);
  return connect.apply(this, args as Parameters<typeof connect>);
} as typeof connect;

const blocked = (what: string) => new Error(`tests must not use the network (tried ${what})`);
const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (this: dgram.Socket, ...args: unknown[]) {
  const host = args.slice(1).find((a): a is string => typeof a === "string");
  if (host === undefined || !LOCAL.has(host)) throw blocked(`UDP to ${host ?? "a connected peer"}`);
  return (send as (...a: unknown[]) => void).apply(this, args);
} as typeof send;
for (const name of ["resolve", "resolve4", "resolve6"] as const) {
  Object.assign(dns, {
    [name]: () => {
      throw blocked(`dns.${name}`);
    },
  });
  Object.assign(dns.promises, { [name]: async () => Promise.reject(blocked(`dns.${name}`)) });
}
