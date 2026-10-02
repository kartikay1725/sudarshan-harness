import { describe, expect, it } from "vitest";
import { defaultPolicy } from "@sudarshan/core";
import { applySpecToPolicy, parseAgentSpec, parseVerifyBlock, renderSpecTemplate, resolveAgent } from "@sudarshan/spec";

const SPEC = `---
name: Repo Janitor
description: Keeps the repository tidy
capabilities: [filesystem, terminal, git]
remove: [http]
permissions: [fs.read, fs.write]
model:
  adapter: ollama
  model: qwen2.5-coder:7b
  temperature: 0.1
approval: [high, critical]
budgets:
  maxSteps: 12
  maxTokens: 50000
---

# Persona

You are a meticulous repository maintainer. You never leave a build broken.

## Rules

- Read a file before editing it.
- Run the test suite after any source change.
- Never touch anything under \`secrets/\`.

## Workflow

1. Inspect the repository.
2. Make the smallest useful change.
3. Verify with tests.

## Scope

roots: .
deny: secrets/**, **/dist/**
denyCommands: rm, curl
allowHosts: api.github.com

## Verify

file_exists README.md
file_contains docs/CHANGELOG.md "## 0.2"
file_not_contains src/index.ts "TODO: remove"
glob_count src/**/*.ts min=1
command npm test exit=0 stdout="passing"
http https://example.com status=200 contains="Example"
dir_exists docs
`;

describe("agent.md", () => {
  it("parses frontmatter into a spec", () => {
    const { spec } = parseAgentSpec(SPEC, "agent.md");
    expect(spec.name).toBe("Repo Janitor");
    expect(spec.capabilities).toEqual(["filesystem", "terminal", "git"]);
    expect(spec.removeCapabilities).toEqual(["http"]);
    expect(spec.permissions).toContain("fs.write");
    expect(spec.model?.adapter).toBe("ollama");
    expect(spec.model?.model).toBe("qwen2.5-coder:7b");
    expect(spec.model?.temperature).toBe(0.1);
    expect(spec.approval.risk).toEqual(["high", "critical"]);
    expect(spec.budgets.maxSteps).toBe(12);
    expect(spec.budgets.maxTokens).toBe(50000);
  });

  it("parses persona, rules and workflow sections", () => {
    const { spec } = parseAgentSpec(SPEC);
    expect(spec.persona).toMatch(/meticulous repository maintainer/);
    expect(spec.rules).toContain("Read a file before editing it.");
    expect(spec.rules.length).toBe(3);
    expect(spec.workflow.length).toBe(3);
  });

  it("turns the Verify block into deterministic checks", () => {
    const { spec } = parseAgentSpec(SPEC);
    const kinds = spec.verification.map((c) => c.kind);
    expect(kinds).toEqual([
      "file_exists",
      "file_contains",
      "file_not_contains",
      "glob_count",
      "command",
      "http",
      "dir_exists",
    ]);
    const contains = spec.verification[1] as { kind: "file_contains"; path: string; text?: string };
    expect(contains.path).toBe("docs/CHANGELOG.md");
    expect(contains.text).toBe("## 0.2");
    const command = spec.verification[4] as { kind: "command"; command: string; args: string[]; expectExit: number; expectStdout?: string };
    expect(command.command).toBe("npm");
    expect(command.args).toEqual(["test"]);
    expect(command.expectExit).toBe(0);
    expect(command.expectStdout).toBe("passing");
    const glob = spec.verification[3] as { kind: "glob_count"; pattern: string; min: number };
    expect(glob.pattern).toBe("src/**/*.ts");
    expect(glob.min).toBe(1);
  });

  it("warns about directives it cannot honour instead of guessing", () => {
    const { warnings } = parseVerifyBlock(["file_exists", "wat_is_this foo", "glob_count src/*.ts min=2"]);
    expect(warnings.join("\n")).toMatch(/needs a path/);
    expect(warnings.join("\n")).toMatch(/unknown verification directive/);
  });

  it("narrows the policy: scopes, deny lists, budgets, approval, expectations", () => {
    const { spec } = parseAgentSpec(SPEC);
    const base = defaultPolicy("/workspace");
    const policy = applySpecToPolicy(spec, base);

    expect(policy.scopes.fsDeny).toContain("secrets/**");
    expect(policy.scopes.fsDeny).toContain("**/.env"); // base protections survive
    expect(policy.scopes.shell.denyCommands).toContain("rm");
    expect(policy.scopes.net.allowHosts).toEqual(["api.github.com"]);
    expect(policy.budgets.maxSteps).toBe(12);
    expect(policy.approval.requireForRisk).toEqual(["high", "critical"]);
    expect(policy.verification.expectations.length).toBe(7);
    expect(policy.permissions).toContain("fs.write");
  });

  it("resolveAgent produces the runtime inputs for a run", () => {
    const { spec } = parseAgentSpec(SPEC);
    const resolved = resolveAgent(defaultPolicy("/workspace"), spec);
    expect(resolved.persona).toMatch(/meticulous/);
    expect(resolved.rules.length).toBe(3);
    expect(resolved.capabilities).toEqual(["filesystem", "terminal", "git"]);
    expect(resolved.removeCapabilities).toEqual(["http"]);
    expect(resolved.model?.adapter).toBe("ollama");
    expect(resolved.policy.verification.expectations.length).toBe(7);
  });

  it("a spec cannot delete the operator's protected paths", () => {
    const { spec } = parseAgentSpec(`---\nname: Sneaky\n---\n\n## Scope\n\nroots: /\n`);
    const base = defaultPolicy("/workspace");
    const policy = applySpecToPolicy(spec, base);
    expect(policy.protectedPaths).toEqual(base.protectedPaths);
    expect(policy.protectedPaths.length).toBeGreaterThan(0);
  });

  it("parses nested frontmatter blocks (scopes, approval objects) and fenced verify sections", () => {
    const raw = `---
name: Nested
capabilities:
  - filesystem
  - http
removeCapabilities:
  - terminal
approval:
  risk:
    - high
  tools:
    - git.commit
scopes:
  fsRoots:
    - .
  fsDeny:
    - "**/.env*"
  allowHosts:
    - example.com
budgets:
  maxSteps: 6
---

## Verify

\`\`\`
file_exists out.md
dir_exists out
\`\`\`
`;
    const { spec, warnings } = parseAgentSpec(raw, "nested.md");
    expect(spec.capabilities).toEqual(["filesystem", "http"]);
    expect(spec.removeCapabilities).toEqual(["terminal"]);
    expect(spec.approval.risk).toEqual(["high"]);
    expect(spec.approval.tools).toEqual(["git.commit"]);
    expect(spec.budgets.maxSteps).toBe(6);
    expect(warnings).toEqual([]);
    expect(spec.verification.map((c) => c.kind)).toEqual(["file_exists", "dir_exists"]);

    const base = defaultPolicy("/workspace");
    const policy = applySpecToPolicy(spec, base);
    expect(policy.scopes.net.allowHosts).toEqual(["example.com"]);
    expect(policy.scopes.fsDeny).toContain("**/.env*");
  });

  it("the generated template round-trips through the parser", () => {
    const template = renderSpecTemplate({ name: "Demo", workspaceRoot: "/tmp/demo", capabilities: ["filesystem", "git"] });
    const { spec } = parseAgentSpec(template);
    expect(spec.name).toBe("Demo");
    expect(spec.capabilities).toEqual(["filesystem", "git"]);
    expect(spec.verification.some((c) => c.kind === "file_exists")).toBe(true);
    expect(spec.verification.some((c) => c.kind === "command")).toBe(true);
    expect(spec.persona).toMatch(/careful engineer/);
  });
});
