import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeFromMessage,
  closeMirrorIssue,
  closeStatus,
  createMirrorIssue,
  launchFromToolResult,
  mirrorDescription,
  mirrorEnv,
  mirrorMarker,
  mirrorShownBesidePane,
  type MirrorEnv,
} from "../lib/paperclip-mirror.ts";

const env: MirrorEnv = {
  apiUrl: "http://127.0.0.1:3100",
  apiKey: "token",
  taskId: "parent-1",
  companyId: "company-1",
};

test("mirror env stays off without Paperclip credentials", () => {
  assert.equal(mirrorEnv({}), null);
});

test("a subagent tool result becomes a child issue and the result closes it", async () => {
  const launch = launchFromToolResult({
    toolName: "subagent",
    isError: false,
    input: { agent: "worker", name: "fix-login", task: "Repair the login form." },
  });
  assert.ok(launch);
  assert.equal(launchFromToolResult({ toolName: "subagent", isError: true, input: { agent: "worker", name: "x", task: "y" } }), null);
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let children: Array<{ id: string; description: string; status: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url.includes("/issues?") && method === "GET") return Response.json(children);
    if (url.endsWith("/children")) {
      children = [{ id: "child-1", description: mirrorMarker("fix-login"), status: "todo" }];
      return Response.json({ id: "child-1" });
    }
    return Response.json({ ok: true });
  };
  const issueId = await createMirrorIssue({ env, launch: launch!, fetchImpl });
  assert.equal(issueId, "child-1");
  const created = calls.find((call) => call.url.endsWith("/children"));
  assert.equal(created?.method, "POST");
  assert.equal((created?.body as { assigneeAgentId?: string }).assigneeAgentId, undefined);
  assert.equal((created?.body as { status: string }).status, "todo");
  assert.match((created?.body as { description: string }).description, /ultimate-pi-mirror:fix-login/);
  assert.equal(mirrorDescription("Repair the login form.", "fix-login").includes("Repair the login form."), true);
  assert.equal(mirrorShownBesidePane("fix-login", ["fix-login"]), true);
  assert.equal(mirrorShownBesidePane("fix-login", ["other"]), false);

  const again = await createMirrorIssue({ env, launch: launch!, fetchImpl });
  assert.equal(again, "child-1");
  assert.equal(calls.filter((call) => call.url.endsWith("/children")).length, 1);

  const close = closeFromMessage({
    role: "custom",
    customType: "subagent_result",
    content: "Login form builds.",
    details: { name: "fix-login", exitCode: 0 },
  });
  assert.equal(closeStatus(0), "done");
  assert.equal(closeStatus(1), "blocked");
  assert.equal(await closeMirrorIssue({ env, issueId: issueId!, close: close!, fetchImpl }), true);
  const comment = calls.find((call) => call.url.endsWith("/comments"));
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal((comment?.body as { body: string }).body, "Login form builds.");
  assert.equal((patch?.body as { status: string }).status, "done");
});
