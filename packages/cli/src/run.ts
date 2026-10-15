import { resolve } from "node:path";
import { AimemError } from "@aimem/core";
import { RECORD_TYPES, type RecordType } from "@aimem/schema";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { type ContextOptions, context } from "./commands/context.js";
import { init } from "./commands/init.js";
import { indexCmd, validateCmd } from "./commands/maintain.js";
import { list, searchCmd, show } from "./commands/read.js";
import { doctor, type HandoffOptions, handoff, status } from "./commands/session.js";
import { type AddOptions, add, supersede, update, verify } from "./commands/write.js";
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
    else {
      deps.stderr(`error ${code}: ${message}\n`);
      if (typeof details?.template === "string") deps.stderr(`\nTemplate:\n${details.template}\n`);
    }
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

  cmd("context", "start-of-session briefing (06 §2)")
    .option("--task <text>", "what you were asked to do")
    .option("--ref <task-ref>", "task this session works on")
    .option(
      "--paths <globs>",
      "files or globs you will touch (comma-separated, repeatable)",
      (v: string, prev: string[] = []) => [...prev, v],
    )
    .option("--role <role>", "rank records for this role")
    .option("--budget <tokens>", "token budget (default from project.yaml, else 4000)", positiveInt)
    .addOption(new Option("--format <format>", "md | json").default("md"))
    .option("--include-superseded", "include superseded/rejected/cancelled/done/retired records")
    .option("--no-live", "skip live claims (claims arrive in M3)")
    .option("--explain", "show why each record was selected")
    .addOption(new Option("--mode <mode>", "lexical | hybrid").default("lexical"))
    .option("--deep", "reserved (not defined yet)")
    .action(action("context", (g, _a, o) => context(deps, g, o as unknown as ContextOptions)));

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

  const collect = (v: string, prev: string[] = []) => [...prev, v];
  const addCommand = (name: string, description: string, fixedType?: RecordType) => {
    const c = cmd(name, description);
    if (!fixedType) c.argument("<type>", `record type (${RECORD_TYPES.join(", ")})`);
    return c
      .requiredOption("--title <text>", "title, at most 120 characters")
      .requiredOption("--summary <text>", "one line, at most 200 characters")
      .option("--status <status>", "initial status (default per type)")
      .option("--roles <list>", "comma-separated roles (default: all)")
      .option("--tags <list>", "comma-separated tags")
      .option("--paths <list>", "comma-separated globs of related code")
      .option("--link <ref>", "related record (repeatable)", collect)
      .option("--supersedes <ref>", "record this one replaces")
      .option("--body <text>", "body text, or - to read stdin")
      .option("--body-file <path>", "read the body from a file")
      .option("--kind <kind>", "memory kind: gotcha | constraint | howto | fact | preference")
      .option("--priority <p>", "task priority p0..p3")
      .option("--assignee <handle>", "task assignee")
      .option("--force", "skip the duplicate check")
      .option("--author <who>", "human:<handle> or agent:<tool>[:<model>]")
      .action(
        action(name, (g, a, o) =>
          fixedType
            ? add(deps, g, fixedType, o as unknown as AddOptions)
            : add(deps, g, a[0] as string, o as unknown as AddOptions),
        ),
      );
  };
  addCommand("add", "create a record");
  addCommand("decide", "create a decision", "decision");
  addCommand("remember", "create a memory", "memory");
  addCommand("incident", "create an incident", "incident");
  addCommand("runbook", "create a runbook", "runbook");

  cmd("update", "edit fields or the body of a record")
    .argument("<ref>", "record ref")
    .option("--set <key=value>", "set a field; empty value removes it (repeatable)", collect)
    .option("--body <text>", "new body, or - to read stdin")
    .option("--body-file <path>", "read the new body from a file")
    .option("--force", "allow editing a handoff body")
    .option("--author <who>", "human:<handle> or agent:<tool>[:<model>]")
    .action(action("update", (g, [ref], o) => update(deps, g, ref as string, o)));

  cmd("supersede", "mark a record as replaced by another")
    .argument("<old-ref>", "record being replaced")
    .requiredOption("--by <new-ref>", "the replacement")
    .option("--author <who>", "human:<handle> or agent:<tool>[:<model>]")
    .action(
      action("supersede", (g, [old], o) =>
        supersede(deps, g, old as string, o as { by: string; author?: string }),
      ),
    );

  cmd("verify", "mark records as confirmed by a human")
    .argument("<refs...>", "records to verify")
    .option("--author <who>", "human:<handle>")
    .action(action("verify", (g, [refs], o) => verify(deps, g, refs as string[], o)));

  cmd("handoff", "write an end-of-session handoff")
    .option("--task <ref>", "task this session worked on")
    .option("--done <text>", "what was done")
    .option("--not-done <text>", "what was not done")
    .option("--next <text>", "what should happen next")
    .option("--blocked <text>", "blockers (default: none)")
    .option("--notes <text>", "notes for the next agent (default: none)")
    .option(
      "--from-file <path>",
      "markdown with ## Done / ## Not done / ## Next / ## Blocked / ## Notes for next agent",
    )
    .option("--release-claims", "release this session's claims (claims arrive in M3)")
    .option("--commit", "commit the handoff even if write_policy only stages")
    .option("--author <who>", "human:<handle> or agent:<tool>[:<model>]")
    .action(action("handoff", (g, _a, o) => handoff(deps, g, o as HandoffOptions)));

  cmd("status", "project overview").action(action("status", (g) => status(deps, g)));
  cmd("doctor", "diagnose the environment (read-only, no network)").action(
    action("doctor", (g) => doctor(deps, g)),
  );

  cmd("validate", "check records against rules V001–V018")
    .option("--strict", "exit 1 on warnings")
    .option("--fix", "repair safe issues first (file names, one-sided supersede links, updated)")
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
