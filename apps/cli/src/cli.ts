#!/usr/bin/env node
/**
 * sudarshan — run governed agent tasks from the terminal.
 *
 * The CLI is a thin shell over the same Harness the IDE uses. Nothing about
 * enforcement lives here: it builds a Harness, streams its events, answers
 * approval prompts on behalf of a human, and prints the verdict.
 */
import { resolve } from "node:path";
import { labelFor } from "@sudarshan/core";
import { parseVerifyBlock } from "@sudarshan/spec";
import { buildHarness, loadConfigFile, recordTrajectory, saveReplay } from "@sudarshan/runtime";
import { bool, list, num, parseArgs, str } from "./args.js";
import { attachApprovals, type ApprovalMode } from "./approvals.js";
import { bullet, c, createLivePrinter, formatSummary, heading, keyValue } from "./render.js";
import { auditCommand, capabilitiesCommand, catalogCommand, doctorCommand, initCommand, promptCommand, replayCommand, specCommand } from "./commands.js";

const VERSION = "0.1.0";

const HELP = `${c.bold("SUDARSHAN HARNESS")} v${VERSION}
${c.grey("Let the AI decide how to do the work. Let Sudarshan decide what it is allowed to do, and whether it actually did it.")}

${c.bold("USAGE")}
  sudarshan <command> [options]

${c.bold("COMMANDS")}
  run <task>          Run a task under the Harness
  ide                 Start the local IDE (daemon + browser UI)
  doctor              Check adapter, capabilities, policy and audit chain
  capabilities        list | catalog | enable <id> | disable <id> | install <id> | remove <id>
  spec [file]         Show what an agent.md will actually do
  prompt [task]       Print the exact system prompt the agent would receive
  init                Write agent.md + sudarshan.config.json templates
  replay <file>       Replay a recorded trajectory offline (real enforcement)
  audit               Verify and inspect the hash-chained audit trail
  adapters            List supported model providers

${c.bold("RUN OPTIONS")}
  -w, --workspace <dir>       Workspace root (default: cwd)
  -a, --adapter <kind>        openai | anthropic | ollama | deepseek | groq | openrouter | lmstudio | vllm | openai-compatible | scripted
  -m, --model <name>          Model name
  -c, --capabilities <list>   Comma-separated capability ids to enable
      --preset <name>         coding | research | minimal | full
  -s, --spec <path>           Path to agent.md
  -e, --expect <check>        Acceptance criterion (repeatable). Same DSL as agent.md's ## Verify
      --max-steps <n>         Step budget
      --max-tokens <n>        Token budget
      --blind-verifier        Run the secondary blind verifier before declaring success
      --approval-mode <m>     interactive (default) | auto | deny
      --approval-timeout <ms> Fail closed if no human answers in time
      --dry-run               Show the plan (prompt, tools, policy, checks) without calling a model
      --record <file>         Save the trajectory as a replayable recording
      --json                  Machine-readable output
  -v, --verbose               Stream model output and logs

${c.bold("EXIT CODES")}
  0 verified · 1 failed/blocked/verification_failed · 2 usage error · 3 completed but NOT verified

${c.bold("EXAMPLES")}
  sudarshan run "Add a CHANGELOG entry for 0.2 and run the tests"
  sudarshan run "Summarise every markdown file into summary.md" --capabilities filesystem --expect file_exists summary.md
  sudarshan doctor
  sudarshan spec agent.md
  sudarshan replay examples/replays/tidy-inbox.json
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (bool(args.flags, "version")) {
    console.log(VERSION);
    return 0;
  }
  if (!args.command || bool(args.flags, "help")) {
    console.log(HELP);
    return args.command ? 0 : 2;
  }

  switch (args.command) {
    case "run":
      return runCommand(args);
    case "ide":
      return ideCommand(args);
    case "doctor":
      return doctorCommand(args);
    case "capabilities":
    case "caps":
      return capabilitiesCommand(args);
    case "spec":
      return specCommand(args);
    case "prompt":
      return promptCommand(args);
    case "init":
      return initCommand(args);
    case "replay":
      return replayCommand(args);
    case "audit":
      return auditCommand(args);
    case "adapters":
      return catalogCommand();
    case "help":
      console.log(HELP);
      return 0;
    default:
      console.error(c.red(`unknown command "${args.command}"`));
      console.log(HELP);
      return 2;
  }
}

async function runCommand(args: ReturnType<typeof parseArgs>): Promise<number> {
  const task = args.positionals.join(" ").trim();
  if (!task) {
    console.error(c.red('usage: sudarshan run "your task"'));
    return 2;
  }

  const workspaceRoot = resolve(str(args.flags, "workspace") ?? process.cwd());
  const fileConfig = await loadConfigFile(workspaceRoot).catch((err) => {
    console.error(c.red(`could not read sudarshan.config.json: ${(err as Error).message}`));
    return undefined;
  });

  const adapterKind = str(args.flags, "adapter");
  const capabilities = list(args.flags, "capabilities");
  const preset = str(args.flags, "preset");

  const built = await buildHarness({
    ...fileConfig,
    workspaceRoot,
    adapter: adapterKind ? { kind: adapterKind as never, model: str(args.flags, "model"), baseURL: str(args.flags, "base-url") } : fileConfig?.adapter,
    model: str(args.flags, "model") ?? fileConfig?.model,
    capabilities: {
      ...(fileConfig?.capabilities ?? {}),
      ...(capabilities.length ? { install: capabilities, enabled: capabilities } : {}),
      ...(preset ? { preset } : {}),
    },
    specPath: str(args.flags, "spec") ?? fileConfig?.specPath,
    budgets: {
      ...(fileConfig?.budgets ?? {}),
      ...(num(args.flags, "max-steps") ? { maxSteps: num(args.flags, "max-steps")! } : {}),
      ...(num(args.flags, "max-tokens") ? { maxTokens: num(args.flags, "max-tokens")! } : {}),
      ...(num(args.flags, "max-tool-calls") ? { maxToolCalls: num(args.flags, "max-tool-calls")! } : {}),
    },
    verifier: { ...(fileConfig?.verifier ?? {}), enabled: bool(args.flags, "blind-verifier") || fileConfig?.verifier?.enabled },
    auditPath: str(args.flags, "audit-file") ?? fileConfig?.auditPath,
  });

  // agent.md's own criteria are already inside policy.verification.expectations;
  // --expect adds to them. Never pass the spec's checks twice.
  const expectLines = list(args.flags, "expect");
  const parsedExpectations = parseVerifyBlock(expectLines);
  const expectations = parsedExpectations.checks;
  const allExpectations = [...expectations, ...(built.spec?.verification ?? [])];
  for (const warning of parsedExpectations.warnings) console.error(c.yellow(`warning: ${warning}`));

  if (!bool(args.flags, "json")) {
    console.log(heading("sudarshan harness"));
    console.log(keyValue("workspace", built.config.workspaceRoot!));
    console.log(keyValue("adapter", `${built.adapterId} / ${built.model}`));
    console.log(keyValue("capabilities", built.capabilities.map((x) => (x.enabled ? c.green(`${x.id}✓`) : c.grey(`${x.id}○`))).join(" ")));
    console.log(keyValue("tools", String(built.harness.tools().length)));
    console.log(keyValue("agent.md", built.spec?.path ?? c.grey("none")));
    console.log(keyValue("policy", `deny-by-default · ${built.policy.permissions.length} permissions · ${built.policy.rules.length} rules · ${built.policy.protectedPaths.length} protected paths`));
    console.log(keyValue("budgets", `steps=${built.policy.budgets.maxSteps} calls=${built.policy.budgets.maxToolCalls} tokens=${built.policy.budgets.maxTokens}`));
    console.log(keyValue("acceptance", allExpectations.length ? c.green(`${allExpectations.length} deterministic check(s)`) : c.yellow("none — the task itself will not be verifiable")));
    for (const expectation of allExpectations) {
      const fromSpec = (built.spec?.verification ?? []).includes(expectation);
      console.log(bullet(`${c.grey("check:")} ${labelFor(expectation)} ${fromSpec ? c.grey("(agent.md)") : c.grey("(--expect)")}`));
    }
    if (built.warnings.length) {
      console.log(heading("warnings"));
      for (const warning of built.warnings) console.log(bullet(c.yellow(warning)));
    }
    console.log(heading("task"));
    console.log(`  ${task}`);
  }

  if (bool(args.flags, "dry-run")) {
    console.log(heading("system prompt the agent will receive"));
    console.log(built.harness.systemPromptPreview(task, allExpectations));
    console.log(heading("tools exposed to the model"));
    for (const tool of built.harness.tools()) console.log(bullet(`${c.bold(tool.name)} — ${tool.description.slice(0, 100)}`));
    console.log(`\n  ${c.grey("dry run: no model was called and nothing was executed.")}\n`);
    return 0;
  }

  const approvalMode = (str(args.flags, "approval-mode") ?? "interactive") as ApprovalMode;
  if (!["interactive", "auto", "deny"].includes(approvalMode)) {
    console.error(c.red(`--approval-mode must be interactive, auto or deny`));
    return 2;
  }

  const detachApprovals = attachApprovals(built.harness, approvalMode, { timeoutMs: num(args.flags, "approval-timeout") });
  const printer = createLivePrinter({ verbose: bool(args.flags, "verbose") });
  const detachPrinter = bool(args.flags, "json") ? () => undefined : built.harness.bus.on(printer);

  const started = Date.now();
  let exitCode = 1;
  try {
    const run = await built.harness.run(task, {
      model: built.model,
      temperature: num(args.flags, "temperature") ?? built.spec?.model?.temperature ?? 0.2,
      maxTokens: num(args.flags, "max-output-tokens") ?? built.spec?.model?.maxTokens,
      expectations,
      persona: built.spec?.persona,
      rules: built.spec?.rules,
      specPath: built.spec?.path,
      approvalTimeoutMs: num(args.flags, "approval-timeout"),
    });

    const recordPath = str(args.flags, "record");
    if (recordPath) {
      await saveReplay(recordTrajectory(run), resolve(recordPath));
    }

    if (bool(args.flags, "json")) {
      console.log(JSON.stringify({ run, audit: built.harness.audit.all(), durationMs: Date.now() - started }, null, 2));
    } else {
      for (const line of formatSummary(run)) console.log(line);
      if (recordPath) console.log(`  ${c.green("✓")} trajectory recorded to ${recordPath}`);
    }

    exitCode = run.status === "verified" ? 0 : run.status === "completed_unverified" ? 3 : 1;
  } catch (err) {
    console.error(c.red(`\nrun failed: ${(err as Error).message}\n`));
    exitCode = 1;
  } finally {
    detachApprovals();
    detachPrinter();
    await built.harness.audit.flush();
  }
  return exitCode;
}

async function ideCommand(args: ReturnType<typeof parseArgs>): Promise<number> {
  const port = num(args.flags, "port") ?? Number(process.env.SUDARSHAN_PORT ?? 8787);
  const host = str(args.flags, "host") ?? "0.0.0.0";
  const workspaceRoot = resolve(str(args.flags, "workspace") ?? process.cwd());
  const { startServer } = await import("@sudarshan/server");
  const server = await startServer({ port, host, workspaceRoot });
  console.log(heading("sudarshan ide"));
  console.log(keyValue("daemon", `http://${host === "0.0.0.0" ? "localhost" : host}:${server.port}`));
  console.log(keyValue("workspace", workspaceRoot));
  console.log(`\n  ${c.grey("Open the URL above. Press Ctrl+C to stop.\n")}`);
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => undefined);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(c.red(err instanceof Error ? err.stack ?? err.message : String(err)));
    process.exitCode = 1;
  });
