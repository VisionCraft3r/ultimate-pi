import dns from "node:dns";
import { isIP } from "node:net";

function ipv4Blocked(a: number, b: number, c: number, d: number): boolean {
	if (a === 0) return true; // 0.0.0.0/8
	if (a === 10) return true; // 10/8
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
	if (a === 127) return true; // 127/8
	if (a === 169 && b === 254) return true; // 169.254/16
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
	if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24
	if (a === 192 && b === 168) return true; // 192.168/16
	if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
	if (a >= 224 && a <= 239) return true; // 224/4
	if (a >= 240) return true; // 240/4 (includes 255.255.255.255)
	return false;
}

function parseIpv4(ip: string): [number, number, number, number] | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	const nums: number[] = [];
	for (const part of parts) {
		if (!/^\d+$/.test(part)) return null;
		const n = Number(part);
		if (n < 0 || n > 255) return null;
		nums.push(n);
	}
	return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

export function isBlockedAddress(ip: string): boolean {
	const version = isIP(ip);
	if (version === 4) {
		const parsed = parseIpv4(ip);
		if (!parsed) return true;
		return ipv4Blocked(...parsed);
	}
	if (version === 6) {
		const lower = ip.toLowerCase();
		if (lower === "::" || lower === "::1") return true;
		if (/^fc[0-9a-f][0-9a-f]:/i.test(lower) || /^fd[0-9a-f][0-9a-f]:/i.test(lower)) return true; // fc00::/7
		if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
			return true; // fe80::/10
		}
		if (lower.startsWith("ff")) return true; // ff00::/8
		const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
		if (v4mapped) {
			const parsed = parseIpv4(v4mapped[1]!);
			if (!parsed) return true;
			return ipv4Blocked(...parsed);
		}
		return false;
	}
	// Not a recognized IP literal; treat as unsafe.
	return true;
}

function stripBrackets(host: string): string {
	if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1);
	return host;
}

export async function assertPublicUrl(
	url: URL,
	lookup: typeof dns.promises.lookup = dns.promises.lookup,
): Promise<void> {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Blocked non-public address: ${url.hostname}`);
	}
	const host = stripBrackets(url.hostname);
	const lowerHost = host.toLowerCase();
	if (lowerHost === "localhost" || lowerHost.endsWith(".localhost")) {
		throw new Error(`Blocked non-public address: ${host}`);
	}
	if (isIP(host)) {
		if (isBlockedAddress(host)) {
			throw new Error(`Blocked non-public address: ${host}`);
		}
		return;
	}
	const addresses = await lookup(host, { all: true });
	for (const addr of addresses) {
		if (isBlockedAddress(addr.address)) {
			throw new Error(`Blocked non-public address: ${host}`);
		}
	}
}
