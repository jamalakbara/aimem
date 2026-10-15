import { resolve } from "node:path";
import { AimemError } from "@aimem/core";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { init } from "./commands/init.js";
import { indexCmd, validateCmd } from "./commands/maintain.js";
import { list, searchCmd, show } from "./commands/read.js";
import type { CliDeps, CommandResult, GlobalOptions } from "./deps.js";
import { EXIT_CODES, failureEnvelope, successEnvelope } from "./output.js";

export const VERSION = "0.0.1";

function positiveInt(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("must be a positive integer");
  return n;
}

/** Run the CLI in-process. Returns the exit code; never calls process.exit. */
export async function run(argv: string[], deps: CliDeps): Promise<number> {
  const jsonMode = argv.includes("--json");
  let exitCode = 0;

  const fail = (code: string, message: string, details?: Record<string, unknown>) => {
    if (jsonMode) deps.stdout(failureEnvelope(code, message, details));
    else deps.stderr(`error ${code}: ${message}\n`);
    exitCode = EXIT_CODES[code as keyof typeof EXIT_CODES] ?? 2;
  };

  const program = new Command("aimem")
    .description("Shared, versioned project notebook for humans and AI agents")
    .version(VERSION, "-V, --version")
    .exitOverride()
    .showSuggestionAfterError()
    // Errors are reported once, by `fail`.
    .configureOutput({ writeOut: (s) => deps.stdout(s), writeErr: () => undefined });

  /** Global flags (04 §1) are accepted on every command. */
  const cmd = (name: string, description: string) =>
    program
      .command(name)
      .description(description)
      .exitOverride()
      .option("--json", "machine-readable output on stdout")
      .option("-y, --yes", "never prompt; use defaults")
      .option("--dir <path>", "start directory (default: cwd)")
      .option("--quiet", "less output")
      .option("--verbose", "more output");

  const globals = (o: Record<string, unknown>): GlobalOptions => ({
    json: Boolean(o.json),
    quiet: Boolean(o.quiet),
    verbose: Boolean(o.verbose),
    dir: resolve(deps.cwd, typeof o.dir === "string" ? o.dir : "."),
  });

  const emit = (command: string, g: GlobalOptions, r: CommandResult) => {
    const warnings = r.warnings ?? [];
    if (g.json) {
      deps.stdout(
        r.failure
          ? failureEnvelope(r.failure.code, r.failure.message, r.failure.details)
          : successEnvelope(command, r.data, warnings),
      );
    } else {
      deps.stdout(r.text);
      if (!g.quiet && command !== "validate") for (const w of warnings) deps.stderr(`warning: ${w}\n`);
    }
    exitCode = r.exitCode ?? (r.failure ? (EXIT_CODES[r.failure.code as keyof typeof EXIT_CODES] ?? 2) : 0);
  };

  /** Commander calls actions with (...arguments, options, command). */
  const action =
    (
      name: string,
      fn: (g: GlobalOptions, args: unknown[], opts: Record<string, unknown>) => Promise<CommandResult>,
    ) =>
    async (...args: unknown[]) => {
      const opts = (args[args.length - 1] as Command).opts();
      const g = globals(opts);
      emit(name, g, await fn(g, args.slice(0, -2), opts));
    };

  cmd("init", "create .aimem/ in this repo")
    .option("--solo", "solo mode (default)")
    .option("--team", "team mode")
    .option("--project <slug>", "project slug (default: folder name)")
    .option("--repo <name>", "name of this repo within the project")
    .option("--roles <list>", "comma-separated roles")
    .option("--force", "re-create project.yaml in an existing notebook (records untouched)")
    .option("--no-intake", "do not print the intake questions")
    .action(action("init", (g, _a, o) => init(deps, g, o as Parameters<typeof init>[2])));

  cmd("show", "print one record")
    .argument("<ref>", "record ref, e.g. dec-7k3m9q2x")
    .option("--raw", "print the file text")
    .option("--links", "include linked records' summaries")
    .action(action("show", (g, [ref], o) => show(deps, g, ref as string, o)));

  cmd("list", "list records")
    .argument("[type]", "record type")
    .option("--status <list>", "comma-separated statuses")
    .option("--trust <level>", "verified | agent | inferred")
    .option("--tag <list>", "comma-separated tags")
    .option("--stale", "only stale or expired records")
    .action(action("list", (g, [type], o) => list(deps, g, type as string | undefined, o)));

  cmd("search", "keyword search")
    .argument("<query>", "search text")
    .option("--type <list>", "comma-separated types")
    .option("--status <list>", "comma-separated statuses (also shows hidden ones)")
    .option("--tag <list>", "comma-separated tags")
    .option("--role <list>", "comma-separated roles")
    .option("--repo <name>", "repo name")
    .option("--paths <list>", "comma-separated files or globs")
    .option("--limit <n>", "maximum results", positiveInt, 10)
    .option("--include-superseded", "include superseded/rejected/cancelled/done/retired records")
    .addOption(new Option("--mode <mode>", "lexical | hybrid").default("lexical"))
    .action(
      action("search", (g, [q], o) => searchCmd(deps, g, q as string, o as Parameters<typeof searchCmd>[3])),
    );

  cmd("validate", "check records against rules V001–V018")
    .option("--strict", "exit 1 on warnings")
    .action(action("validate", (g, _a, o) => validateCmd(deps, g, o)));

  cmd("index", "regenerate INDEX.md").action(action("index", (g) => indexCmd(deps, g)));

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.exitCode === 0) return 0; // --help, --version
      if (e.code === "commander.help") {
        if (!jsonMode) deps.stderr(program.helpInformation());
        fail("USAGE", "a command is required (see aimem --help)");
      } else fail("USAGE", e.message.replace(/^error: /, ""));
    } else if (e instanceof AimemError) {
      fail(e.code, e.message, e.details);
    } else {
      deps.stderr(`internal error: ${(e as Error).stack ?? String(e)}\n`);
      exitCode = 2;
    }
  }
  return exitCode;
}
