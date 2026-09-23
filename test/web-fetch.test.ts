import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_AGENT } from "../extensions/web-fetch/index.ts";

test("web-fetch User-Agent is generic and not Macintosh-specific", () => {
	assert.match(USER_AGENT, /Mozilla\/5\.0 \(compatible; ultimate-pi\/1\.0\.0-alpha\)/);
	assert.doesNotMatch(USER_AGENT, /Macintosh/i);
	assert.doesNotMatch(USER_AGENT, /Mac OS X/i);
	assert.doesNotMatch(USER_AGENT, /Windows NT/i);
});
