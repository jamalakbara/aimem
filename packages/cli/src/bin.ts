#!/usr/bin/env node
import { cryptoRandom, nodeFs, systemClock } from "@aimem/core";
import { run } from "./run.js";

process.exitCode = await run(process.argv.slice(2), {
  fs: nodeFs,
  clock: systemClock,
  random: cryptoRandom,
  env: process.env,
  cwd: process.cwd(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
