import { describe, expect, it, afterEach } from "vitest";
import { createWorkspace, createTestHarness, type TestWorkspace } from "./helpers.js";

/**
 * STATE A -> action -> STATE B -> rollback -> A'
 *
 * A rollback is only reported as successful when the Harness re-observes the
 * prior state. `roundTripVerified` is that proof.
 */
describe("state transitions and recovery", () => {
  let ws: TestWorkspace | undefined;

  afterEach(async () => {
    await ws?.cleanup();
    ws = undefined;
  });

  it("records a transition and restores the exact prior content", async () => {
    ws = await createWorkspace("rollback");
    await ws.write("config.json", '{"mode":"safe"}');
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.write", arguments: { path: "config.json", content: '{"mode":"yolo"}' } },
        { kind: "text", content: "changed it" },
      ],
    });

    const run = await harness.run("Switch config.json to yolo mode.", { model: "scripted" });
    const action = run.steps.flatMap((s) => s.actions)[0]!;
    expect(action.transition).toBeDefined();
    expect(action.transition!.reversibility).toBe("reversible");
    expect(action.transition!.undoOps.length).toBe(1);
    expect(await ws.read("config.json")).toBe('{"mode":"yolo"}');

    // The Harness kept the pre-action snapshot, so the rollback can be proved.
    const stored = harness.state.snapshotFor(action.transition!.id)!;
    expect(stored.before?.paths[0]!.sha256).toBeDefined();

    const outcome = await harness.rollback(action.transition!.id);
    expect(outcome.ok).toBe(true);
    expect(outcome.verified).toBe(true);
    expect(await ws.read("config.json")).toBe('{"mode":"safe"}');

    const transition = harness.state.get(action.transition!.id)!;
    expect(transition.rolledBack).toBe(true);
    expect(transition.roundTripVerified).toBe(true);
  });

  it("removes a file that did not exist before", async () => {
    ws = await createWorkspace("rollback-created");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.write", arguments: { path: "new.txt", content: "fresh" } },
        { kind: "text", content: "created" },
      ],
    });
    const run = await harness.run("Create new.txt.", { model: "scripted" });
    const action = run.steps.flatMap((s) => s.actions)[0]!;
    expect(await ws.exists("new.txt")).toBe(true);

    const outcome = await harness.rollback(action.transition!.id);
    expect(outcome.ok).toBe(true);
    expect(outcome.verified).toBe(true);
    expect(await ws.exists("new.txt")).toBe(false);
  });

  it("undoes a move by renaming back", async () => {
    ws = await createWorkspace("rollback-move");
    await ws.write("old/name.txt", "content");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.move", arguments: { from: "old/name.txt", to: "new/name.txt" } },
        { kind: "text", content: "moved" },
      ],
    });
    const run = await harness.run("Move the file into new/.", { model: "scripted" });
    const action = run.steps.flatMap((s) => s.actions)[0]!;
    expect(action.verification?.status).toBe("passed");
    expect(await ws.exists("new/name.txt")).toBe(true);

    const outcome = await harness.rollback(action.transition!.id);
    expect(outcome.ok).toBe(true);
    expect(outcome.verified).toBe(true);
    expect(await ws.exists("old/name.txt")).toBe(true);
    expect(await ws.exists("new/name.txt")).toBe(false);
  });

  it("reports honestly when nothing can be undone", async () => {
    ws = await createWorkspace("rollback-none");
    const harness = await createTestHarness(ws, {
      capabilities: ["filesystem"],
      script: [{ kind: "text", content: "nothing to do" }],
    });
    await harness.run("No-op.", { model: "scripted" });
    // A transition that was never recorded cannot be rolled back.
    const outcome = await harness.rollback("trn_doesnotexist");
    expect(outcome.ok).toBe(false);
    expect(outcome.verified).toBe(false);
  });

  it("exposes rollback candidates for the IDE recovery panel", async () => {
    ws = await createWorkspace("rollback-list");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.write", arguments: { path: "a.txt", content: "a" } },
        { kind: "tool", name: "filesystem.write", arguments: { path: "b.txt", content: "b" } },
        { kind: "text", content: "done" },
      ],
    });
    await harness.run("Write two files.", { model: "scripted" });
    expect(harness.state.rollbackable().length).toBe(2);
    await harness.rollback(harness.state.rollbackable()[0]!.id);
    expect(harness.state.rollbackable().length).toBe(1);
  });
});
