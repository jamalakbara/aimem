import { execSync } from "node:child_process";

/** Build once so end-to-end tests run the real `aimem` binary (packages/cli/dist/bin.js). */
export default function setup(): void {
  execSync("pnpm -s build", { stdio: "pipe" });
}
