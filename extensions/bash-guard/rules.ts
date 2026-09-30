/**
 * Catastrophic bash floor. These rules are data: a pattern, why it exists,
 * a safer alternative, and examples that are checked in tests.
 * User rules cannot relax a floor match.
 */

export type BashGuardDecision = { block: true; reason: string };

export type FloorRule = {
	id: string;
	pattern: RegExp;
	reason: string;
	justification: string;
	alternative: string;
	/** Subagents may run this even though the pattern matches (local git only). */
	subagentAllow?: boolean;
	/** Included in the main-session floor when interactive prompting is off. */
	mainFloor: boolean;
	match: string[];
	notMatch: string[];
};

export const FLOOR_RULES: FloorRule[] = [
	{
		id: "rm-recursive",
		pattern: /(?<!\bgit\s+)\brm\b[^#\n]*\s-(?:[a-zA-Z]*[rR]|-\brecursive\b)/,
		reason: "recursive delete (rm -r / -rf / -Rf)",
		justification: "A recursive delete can erase more than the named path and is not recoverable from the session.",
		alternative: "Delete one named file, or move it to a temp path.",
		mainFloor: true,
		match: ["rm -rf /tmp/example"],
		notMatch: ["rm file.txt", "git rm -r foo"],
	},
	{
		id: "sudo",
		pattern: /\bsudo\b/,
		reason: "elevated privileges (sudo)",
		justification: "Elevated commands change the machine outside the repo.",
		alternative: "Run the command without sudo, or ask the parent session to confirm it.",
		mainFloor: true,
		match: ["sudo true"],
		notMatch: ["cat sudoers"],
	},
	{
		id: "pipe-to-shell",
		pattern: /\b(curl|wget)\b[^#\n]*\|\s*(ba?sh|zsh|fish|dash|sh)\b/,
		reason: "pipe to shell (remote code execution)",
		justification: "Piping a download into a shell runs remote code with no review.",
		alternative: "Download the file and inspect it before running anything.",
		mainFloor: true,
		match: ["curl https://example.com/install.sh | bash"],
		notMatch: ["curl https://example.com/install.sh"],
	},
	{
		id: "mkfs",
		pattern: /\bmkfs/,
		reason: "filesystem formatting (mkfs)",
		justification: "Formatting a filesystem destroys the volume.",
		alternative: "Do not format disks from an agent session.",
		mainFloor: true,
		match: ["mkfs.ext4 /dev/sda"],
		notMatch: ["mkdir fs"],
	},
	{
		id: "newfs",
		pattern: /\bnewfs_\w+/,
		reason: "filesystem formatting (newfs_*)",
		justification: "newfs_* formats a volume.",
		alternative: "Do not format disks from an agent session.",
		mainFloor: true,
		match: ["newfs_hfs /dev/disk1"],
		notMatch: ["echo newfs"],
	},
	{
		id: "wipefs",
		pattern: /\bwipefs\b/,
		reason: "disk signature wipe",
		justification: "wipefs removes filesystem signatures.",
		alternative: "Do not wipe disk signatures from an agent session.",
		mainFloor: true,
		match: ["wipefs -a /dev/sda"],
		notMatch: ["echo wipe"],
	},
	{
		id: "diskutil",
		pattern: /\bdiskutil\s+(erase|zeroDisk|secureErase|reformat)/i,
		reason: "destructive disk operation (diskutil)",
		justification: "Erasing or reformatting a disk is not recoverable.",
		alternative: "Use diskutil list for inspection only.",
		mainFloor: true,
		match: ["diskutil eraseDisk APFS x disk1"],
		notMatch: ["diskutil list"],
	},
	{
		id: "dd-device",
		pattern: /\bdd\b[^#\n]*\bof=\/dev\//,
		reason: "raw disk write (dd of=/dev/...)",
		justification: "Writing to a device node overwrites the disk.",
		alternative: "Write dd output to a regular file if you must copy bytes.",
		mainFloor: true,
		match: ["dd if=/dev/zero of=/dev/sda"],
		notMatch: ["dd if=/dev/zero of=file.img"],
	},
	{
		id: "partition-tools",
		pattern: /\b(parted|fdisk|gdisk|sgdisk)\b/,
		reason: "partition table management",
		justification: "Partition tools can make a disk unreadable.",
		alternative: "Do not change partition tables from an agent session.",
		mainFloor: true,
		match: ["parted /dev/sda print"],
		notMatch: ["partitioned"],
	},
	{
		id: "cryptsetup",
		pattern: /\bcryptsetup\b/,
		reason: "disk encryption management",
		justification: "cryptsetup can lock or wipe a volume.",
		alternative: "Do not manage disk encryption from an agent session.",
		mainFloor: true,
		match: ["cryptsetup luksFormat /dev/sda"],
		notMatch: ["encryption"],
	},
	{
		id: "zpool",
		pattern: /\bzpool\b/,
		reason: "ZFS pool management",
		justification: "zpool commands can destroy a pool.",
		alternative: "Do not manage ZFS pools from an agent session.",
		mainFloor: true,
		match: ["zpool destroy tank"],
		notMatch: ["pool"],
	},
	{
		id: "power",
		pattern: /\b(shutdown|reboot|halt|poweroff)\b/,
		reason: "system power operation",
		justification: "Power commands stop the machine.",
		alternative: "Do not shut down or reboot from an agent session.",
		mainFloor: true,
		match: ["shutdown -h now"],
		notMatch: ["echo down"],
	},
	{
		id: "terraform-destroy",
		pattern: /\bterraform\s+destroy\b/,
		reason: "infrastructure teardown (terraform destroy)",
		justification: "terraform destroy deletes remote infrastructure.",
		alternative: "Ask the parent session before any teardown.",
		mainFloor: true,
		match: ["terraform destroy"],
		notMatch: ["terraform plan"],
	},
	{
		id: "kubectl-delete",
		pattern: /\bkubectl\s+delete\b/,
		reason: "Kubernetes resource deletion",
		justification: "kubectl delete removes cluster resources.",
		alternative: "Ask the parent session before deleting cluster resources.",
		mainFloor: true,
		match: ["kubectl delete pod api"],
		notMatch: ["kubectl get pods"],
	},
	{
		id: "aws-s3-rm",
		pattern: /\baws\s+s3\s+rm\b[^#\n]*--recursive/,
		reason: "bulk S3 deletion (aws s3 rm --recursive)",
		justification: "A recursive S3 delete removes a whole prefix.",
		alternative: "Delete one named key, or ask the parent session.",
		mainFloor: true,
		match: ["aws s3 rm s3://bucket/prefix --recursive"],
		notMatch: ["aws s3 ls"],
	},
	{
		id: "git-commit",
		pattern: /\bgit\s+commit\b/,
		reason: "git commit (commits are main-session operations)",
		justification: "Subagents may commit locally. The main floor does not block commit.",
		alternative: "Commit from the worker. Push stays with the parent session.",
		subagentAllow: true,
		mainFloor: false,
		match: ["git commit -m wip"],
		notMatch: ["git status"],
	},
	{
		id: "git-add",
		pattern: /\bgit\s+add\b/,
		reason: "git add (staging is a main-session operation)",
		justification: "Subagents may stage locally. The main floor does not block add.",
		alternative: "Stage from the worker.",
		subagentAllow: true,
		mainFloor: false,
		match: ["git add extensions/bash-guard/index.ts"],
		notMatch: ["git status"],
	},
	{
		id: "git-pull",
		pattern: /\bgit\s+pull\b/,
		reason: "git pull (pulls are main-session operations)",
		justification: "Pull updates remote-tracking state and can merge unexpectedly.",
		alternative: "Ask the parent session to pull.",
		mainFloor: false,
		match: ["git pull"],
		notMatch: ["git status"],
	},
	{
		id: "git-push",
		pattern: /\bgit\s+push\b/,
		reason: "git push (pushes are main-session operations)",
		justification: "Push publishes history. A subagent must not push.",
		alternative: "Ask the parent session to push.",
		mainFloor: false,
		match: ["git push origin main"],
		notMatch: ["git status"],
	},
	{
		id: "git-reset-hard",
		pattern: /\bgit\s+reset\b[^#\n]*--hard\b/,
		reason: "discard all uncommitted changes (git reset --hard)",
		justification: "reset --hard drops uncommitted work.",
		alternative: "Use git restore on the specific file, or ask the parent session.",
		mainFloor: true,
		match: ["git reset --hard HEAD"],
		notMatch: ["git reset HEAD"],
	},
	{
		id: "git-clean",
		pattern: /\bgit\s+clean\b[^#\n]*-[a-zA-Z]*f/,
		reason: "delete untracked files (git clean -f)",
		justification: "git clean -f deletes untracked files.",
		alternative: "Use git clean -n to preview, then delete named files.",
		mainFloor: true,
		match: ["git clean -fd"],
		notMatch: ["git clean -n"],
	},
	{
		id: "git-reflog-expire",
		pattern: /\bgit\s+reflog\s+expire\b/,
		reason: "expire reflog (removes recovery history)",
		justification: "Expiring the reflog removes the recovery path.",
		alternative: "Leave the reflog intact.",
		mainFloor: true,
		match: ["git reflog expire --expire=now --all"],
		notMatch: ["git reflog"],
	},
	{
		id: "git-gc-prune",
		pattern: /\bgit\s+gc\b[^#\n]*--prune\b/,
		reason: "prune unreachable objects (git gc --prune)",
		justification: "Prune drops objects that may still be recoverable.",
		alternative: "Run git gc without --prune.",
		mainFloor: true,
		match: ["git gc --prune=now"],
		notMatch: ["git gc"],
	},
];

/** Same shape the main-session floor used before rules were data. */
export const MAIN_DISABLED_BLOCKED: Array<{ pattern: RegExp; reason: string }> = FLOOR_RULES.filter(
	(rule) => rule.mainFloor,
).map(({ pattern, reason }) => ({ pattern, reason }));

function floorMessage(rule: FloorRule, audience: "headless" | "main"): BashGuardDecision {
	const alternative = rule.alternative ? ` Alternative: ${rule.alternative}` : "";
	const why = ` ${rule.justification}${alternative}`;
	if (audience === "headless") {
		return {
			block: true,
			reason:
				`Blocked by bash-guard: ${rule.reason}.` +
				why +
				" This is a non-interactive subagent session — catastrophic operations are not permitted. " +
				"Propose a safer alternative or ask the parent agent to confirm with the user.",
		};
	}
	return {
		block: true,
		reason:
			`Blocked by bash-guard: ${rule.reason}.` +
			why +
			" Bash-guard interactive prompting is disabled, but the catastrophic-operation floor remains in effect. " +
			"Propose a safer alternative or re-enable bash-guard with /bash-guard.",
	};
}

/** Hard-block floor for non-interactive subagent sessions, with a narrow git add/commit allowlist. */
export function evaluateHeadlessBash(command: string): BashGuardDecision | undefined {
	for (const rule of FLOOR_RULES) {
		if (!rule.pattern.test(command)) continue;
		if (rule.subagentAllow) continue;
		return floorMessage(rule, "headless");
	}
	return undefined;
}

/** Catastrophic floor applied in the main session even when bash-guard is otherwise disabled. */
export function evaluateDisabledMainBash(command: string): BashGuardDecision | undefined {
	for (const rule of FLOOR_RULES) {
		if (!rule.mainFloor) continue;
		if (rule.pattern.test(command)) return floorMessage(rule, "main");
	}
	return undefined;
}

export function floorRuleFor(command: string, headless: boolean): FloorRule | undefined {
	for (const rule of FLOOR_RULES) {
		if (!rule.pattern.test(command)) continue;
		if (headless && rule.subagentAllow) continue;
		if (!headless && !rule.mainFloor) continue;
		return rule;
	}
	return undefined;
}
