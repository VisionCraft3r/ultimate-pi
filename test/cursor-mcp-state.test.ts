import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const patchPath = fileURLToPath(new URL("../patches/pi-cursor-mcp-state-0.5.2.patch", import.meta.url));

function loadEncoder() {
  const added = readFileSync(patchPath, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  const start = added.indexOf("function encodeVarint");
  const end = added.indexOf("function sendCursorExecPayload");
  assert.ok(start >= 0 && end > start);
  const source = added.slice(start, end);
  const load = new Function(
    `${source}\nreturn { decodeServerIdentifiers, encodeMcpStateExecResult, encodeSubagentUnavailable, encodeEmptyMcpResourceList, encodeMcpResourceNotFound, lineageHistoryForRequest, encodeStringField };`,
  );
  return load() as {
    decodeServerIdentifiers: (data: Uint8Array) => string[];
    encodeMcpStateExecResult: (
      tools: Array<{ providerIdentifier?: string }>,
      rawArgs: Uint8Array | undefined,
      serializeTool: (tool: { providerIdentifier?: string }) => Uint8Array,
    ) => Uint8Array;
    encodeSubagentUnavailable: () => Uint8Array;
    encodeEmptyMcpResourceList: () => Uint8Array;
    encodeMcpResourceNotFound: (uri: string) => Uint8Array;
    lineageHistoryForRequest: (
      turns: Array<{ userText: string }>,
      userText: string,
      toolResults: unknown[],
      lastRole: string | undefined,
    ) => Array<{ userText: string }>;
    encodeStringField: (fieldNo: number, text: string) => Uint8Array;
  };
}

function readVarint(bytes: Uint8Array, offset: number): { n: number; offset: number } {
  let n = 0;
  let shift = 0;
  while (offset < bytes.length && shift <= 28) {
    const byte = bytes[offset++]!;
    n |= (byte & 127) << shift;
    if ((byte & 128) === 0) return { n, offset };
    shift += 7;
  }
  return { n, offset };
}

function fieldsOf(bytes: Uint8Array): Array<{ field: number; wire: number; bytes?: Uint8Array; value?: number }> {
  const out = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    offset = key.offset;
    const field = key.n >>> 3;
    const wire = key.n & 7;
    if (wire === 2) {
      const len = readVarint(bytes, offset);
      offset = len.offset;
      out.push({ field, wire, bytes: bytes.subarray(offset, offset + len.n) });
      offset += len.n;
    } else if (wire === 0) {
      const value = readVarint(bytes, offset);
      offset = value.offset;
      out.push({ field, wire, value: value.n });
    } else {
      break;
    }
  }
  return out;
}

const TOOL = new Uint8Array([9, 9, 9]);

test("mcp state exec lists the pi tool server and filters by identifier", () => {
  const api = loadEncoder();
  const tools = [{ providerIdentifier: "pi", name: "mcp_pi_read" }];
  const payload = api.encodeMcpStateExecResult(tools, undefined, () => TOOL);
  const result = fieldsOf(payload);
  assert.deepEqual(result.map((field) => field.field), [1]);
  const success = fieldsOf(result[0]!.bytes!);
  assert.equal(success.length, 1);
  const server = fieldsOf(success[0]!.bytes!);
  const text = (fieldNo: number) => new TextDecoder().decode(server.find((field) => field.field === fieldNo)!.bytes!);
  assert.equal(text(1), "pi");
  assert.equal(text(2), "pi");
  assert.equal(text(7), "connected");
  assert.deepEqual(server.find((field) => field.field === 5)!.bytes, TOOL);

  const onlyPi = api.encodeStringField(1, "pi");
  const filtered = api.encodeMcpStateExecResult(tools, onlyPi, () => TOOL);
  assert.equal(fieldsOf(fieldsOf(filtered)[0]!.bytes!).length, 1);

  const other = api.encodeStringField(1, "other");
  const empty = api.encodeMcpStateExecResult(tools, other, () => TOOL);
  assert.equal(fieldsOf(fieldsOf(empty)[0]!.bytes!).length, 0);
  assert.deepEqual(api.decodeServerIdentifiers(other), ["other"]);
});

test("a cursor-native subagent exec is an error result, not an empty frame", () => {
  const api = loadEncoder();
  const payload = api.encodeSubagentUnavailable();
  const top = fieldsOf(payload);
  assert.deepEqual(top.map((field) => field.field), [2]);
  const error = new TextDecoder().decode(fieldsOf(top[0]!.bytes!).find((field) => field.field === 2)!.bytes!);
  assert.match(error, /mcp_pi_\*/);
  assert.match(error, /already selected/);
});

test("mcp resource probes are real result frames", () => {
  const api = loadEncoder();
  const listed = fieldsOf(api.encodeEmptyMcpResourceList());
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.field, 1);
  assert.equal(listed[0]?.bytes?.length, 0);
  const missing = fieldsOf(api.encodeMcpResourceNotFound("file:///notes.md"));
  assert.equal(missing[0]?.field, 4);
  assert.equal(new TextDecoder().decode(fieldsOf(missing[0]!.bytes!).find((field) => field.field === 1)!.bytes!), "file:///notes.md");
});

test("a tool-result follow-up keeps the user text that the previous turn committed", () => {
  const api = loadEncoder();
  const prior = [{ userText: "earlier" }];
  const followUp = api.lineageHistoryForRequest(prior, "read the file", [{ id: "call" }], "tool");
  assert.deepEqual(followUp.map((turn) => turn.userText), ["earlier", "read the file"]);
  const nextUser = api.lineageHistoryForRequest(
    [...prior, { userText: "read the file" }],
    "now do the next thing",
    [{ id: "call" }],
    "user",
  );
  assert.deepEqual(nextUser.map((turn) => turn.userText), ["earlier", "read the file"]);
});
