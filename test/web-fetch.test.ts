import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_AGENT, fetchPublic, shouldUseJina } from "../extensions/web-fetch/index.ts";
import { assertPublicUrl, isBlockedAddress } from "../extensions/web-fetch/net-guard.ts";

test("web-fetch User-Agent is generic and not Macintosh-specific", () => {
	assert.match(USER_AGENT, /Mozilla\/5\.0 \(compatible; ultimate-pi\/\d+\.\d+\.\d+/);
	assert.doesNotMatch(USER_AGENT, /Macintosh/i);
	assert.doesNotMatch(USER_AGENT, /Mac OS X/i);
	assert.doesNotMatch(USER_AGENT, /Windows NT/i);
});

test("isBlockedAddress blocks private/reserved ranges", () => {
	for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1"]) {
		assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
	}
});

test("isBlockedAddress allows public addresses", () => {
	assert.equal(isBlockedAddress("8.8.8.8"), false);
	assert.equal(isBlockedAddress("2606:4700::1111"), false);
});

test("assertPublicUrl rejects localhost", async () => {
	await assert.rejects(() => assertPublicUrl(new URL("http://localhost/")), /Blocked non-public address/);
});

test("assertPublicUrl rejects a host that resolves to a private address", async () => {
	const lookup = (async () => [{ address: "10.0.0.5", family: 4 }]) as unknown as typeof import("node:dns").promises.lookup;
	await assert.rejects(
		() => assertPublicUrl(new URL("http://internal.example.com/"), lookup),
		/Blocked non-public address/,
	);
});

test("fetchPublic rejects a redirect to a blocked address", async () => {
	const fetchImpl = (async (url: string | URL) => {
		const href = url.toString();
		if (href === "http://example.com/") {
			return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } });
		}
		return new Response("ok");
	}) as unknown as typeof fetch;
	await assert.rejects(
		() => fetchPublic("http://example.com/", undefined, { fetchImpl }),
		/Blocked non-public address/,
	);
});

test("fetchPublic rejects a chain longer than 5 redirects", async () => {
	let hop = 0;
	const fetchImpl = (async () => {
		hop += 1;
		if (hop <= 6) {
			return new Response(null, { status: 302, headers: { location: `http://example.com/${hop}` } });
		}
		return new Response("ok");
	}) as unknown as typeof fetch;
	await assert.rejects(
		() => fetchPublic("http://example.com/0", undefined, { fetchImpl }),
		/Too many redirects/,
	);
});

test("shouldUseJina is false when the env var is unset", () => {
	assert.equal(shouldUseJina("short", "http://example.com/", false, {}), false);
});

test("shouldUseJina is true when opted in and content is short", () => {
	assert.equal(
		shouldUseJina("short", "http://example.com/", false, { ULTIMATE_PI_WEB_FETCH_JINA: "1" }),
		true,
	);
});
