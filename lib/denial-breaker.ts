/**
 * Stops a headless agent that keeps proposing blocked commands.
 * Three consecutive bash-guard denials end the turn. An allowed command resets the count.
 */

export const DENIAL_LIMIT = 3;

export type HeadlessBashResult =
	| { block: true; terminate?: true; reason: string }
	| { allow: true };

export class DenialBreaker {
	private consecutive = 0;

	recordAllowed(): void {
		this.consecutive = 0;
	}

	recordDenial(): { terminate: boolean; count: number } {
		this.consecutive += 1;
		return { terminate: this.consecutive >= DENIAL_LIMIT, count: this.consecutive };
	}
}

export function denialTermination(command: string, count: number): {
	block: true;
	terminate: true;
	reason: string;
} {
	const shown = command.length > 180 ? `${command.slice(0, 180)}…` : command;
	return {
		block: true,
		terminate: true,
		reason:
			`Bash-guard denied ${count} commands in a row. ` +
			`Return Status BLOCKED with the blocked command: ${shown}`,
	};
}

/** Apply one headless bash decision and update the breaker. */
export function headlessBashOutcome(
	breaker: DenialBreaker,
	decision: { block: true; reason: string } | undefined,
	command: string,
): HeadlessBashResult {
	if (!decision) {
		breaker.recordAllowed();
		return { allow: true };
	}
	const hit = breaker.recordDenial();
	if (hit.terminate) return denialTermination(command, hit.count);
	return decision;
}
