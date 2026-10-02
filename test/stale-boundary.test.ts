import assert from "node:assert/strict";
import { test } from "node:test";
import { patchStaleBoundarySource } from "../installer/stale-boundary.mjs";

const EMIT = "async emit(event){let ctx=this.createContext(),result;for(;;){}}";
const DISPATCH =
  'async _dispatchTurnEndBoundary(message,toolResults){if(!messageEntryId)return this._extensionRunner.emitError({extensionPath:"<boundary>",event:"turn_end",error:"turn_end could not resolve the persisted assistant entry ID"}),!1;}';

test("a replaced session skips extension emit and the turn_end boundary", () => {
  const patched = patchStaleBoundarySource(`${EMIT}${DISPATCH}`);
  assert.equal(patched.changed, true);
  assert.match(patched.source, /async emit\(event\)\{if\(this\.staleMessage\)return;/);
  assert.match(patched.source, /_dispatchTurnEndBoundary\(message,toolResults\)\{if\(this\._extensionRunner\.staleMessage\)return!1;/);
  const again = patchStaleBoundarySource(patched.source);
  assert.equal(again.changed, false);
  assert.equal(again.source, patched.source);
});
