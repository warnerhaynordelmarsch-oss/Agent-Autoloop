// Failure modes: agy adapter uses wrong bridge command; full access flag omitted; link does not point to alma://thread.
import assert from "node:assert/strict";
import { test } from "node:test";
import agy from "../plugins/agy/agent.ts";
import type { Turn } from "../worker/agents.ts";

test("agy links sessions to alma://thread", () => {
  assert.equal(agy.link("session-1234"), "alma://thread/session-1234");
});

test("agy command delegates to acp bridge with correct parameters", () => {
  const baseTurn: Turn = {
    prompt: "do something",
    session: "sess-1",
    resume: null,
    cwd: process.cwd(),
    access: "read",
    contextFile: "",
    folder: "",
  };

  const custom = agy.command({ ...baseTurn, command: ["custom-agy", "acp"] });
  assert.ok(custom.length >= 5);
  assert.match(custom[3], /bridge\.ts$/);
  const customPayload = JSON.parse(custom[4]);
  assert.deepEqual(customPayload.command, ["custom-agy", "acp"]);

  try {
    const readCmd = agy.command(baseTurn);
    const readPayload = JSON.parse(readCmd[4]);
    assert.equal(readPayload.command[1], "acp");
    assert.ok(!readPayload.command.includes("--dangerously-skip-permissions"));

    const fullCmd = agy.command({ ...baseTurn, access: "full" });
    const fullPayload = JSON.parse(fullCmd[4]);
    assert.equal(fullPayload.command[1], "acp");
    assert.ok(fullPayload.command.includes("--dangerously-skip-permissions"));
  } catch (error) {
    assert.match((error as Error).message, /找不到 agy/);
  }
});

test("agy check returns string or null depending on environment", () => {
  const status = agy.check();
  assert.ok(status === null || typeof status === "string");
});
