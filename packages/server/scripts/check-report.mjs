// Fails the CI job `server` unless the database tests really ran (plan 6.1 §7.2, QA W9, CI-2):
// at least one test, none skipped or todo, none failed.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "server-report.json";
const r = JSON.parse(readFileSync(file, "utf8"));
const problems = [];
if (!(r.numTotalTests > 0)) problems.push(`no server tests ran (${r.numTotalTests})`);
if (r.numPendingTests) problems.push(`${r.numPendingTests} skipped`);
if (r.numTodoTests) problems.push(`${r.numTodoTests} todo`);
if (r.numFailedTests) problems.push(`${r.numFailedTests} failed`);
if (r.numFailedTestSuites) problems.push(`${r.numFailedTestSuites} files failed`);
if (!r.success) problems.push("the run did not succeed");
console.log(`server tests: ${r.numPassedTests}/${r.numTotalTests} passed, ${r.numPendingTests} skipped`);
if (problems.length) {
  console.error(`server tests are not a valid proof: ${problems.join("; ")}`);
  process.exit(1);
}
