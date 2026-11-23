import { Socket } from "node:net";

/**
 * No test may reach the network (QA plan 16): connectors run on recorded responses. Local sockets stay
 * allowed, because some tests start their own servers.
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
