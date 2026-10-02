/**
 * Pi invalidates an extension context after newSession, fork, switchSession,
 * or reload. Getters then throw. Event handlers still run on that context.
 * Reading one returns the fallback instead of failing the turn.
 */
export function isReplacedSessionError(error: unknown): boolean {
	const text = error instanceof Error ? error.message : String(error);
	return text.includes("stale after session replacement or reload");
}

export function ifActiveSession<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch (error) {
		if (isReplacedSessionError(error)) return fallback;
		throw error;
	}
}
