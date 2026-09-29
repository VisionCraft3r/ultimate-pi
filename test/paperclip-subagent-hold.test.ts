import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldHoldSubagents, waitForSubagentWake } from "../lib/paperclip-subagent-hold.ts";

test("a local run does not wait for subagents", async () => {
  let slept = 0;
  const result = await waitForSubagentWake({
    paperclip: false,
    running: () => 1,
    seq: () => 0,
    sleep: async () => {
      slept += 1;
    },
  });
  assert.equal(result, "idle");
  assert.equal(slept, 0);
  assert.equal(shouldHoldSubagents({ paperclip: false, running: 2 }), false);
});

test("a Paperclip run with no subagents settles immediately", async () => {
  let slept = 0;
  const result = await waitForSubagentWake({
    paperclip: true,
    running: () => 0,
    seq: () => 4,
    sleep: async () => {
      slept += 1;
    },
  });
  assert.equal(result, "idle");
  assert.equal(slept, 0);
});

test("a Paperclip run waits until a new parent wake", async () => {
  let seq = 3;
  let slept = 0;
  const result = await waitForSubagentWake({
    paperclip: true,
    intervalMs: 200,
    running: () => 1,
    seq: () => seq,
    sleep: async () => {
      slept += 1;
      if (slept === 2) seq = 4;
    },
  });
  assert.equal(result, "woke");
  assert.equal(slept, 2);
  assert.equal(seq, 4);
});
