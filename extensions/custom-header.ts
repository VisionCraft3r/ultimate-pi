/**
 * Custom Header Extension
 *
 * Replaces the built-in startup header. This file lives in
 * <agentDir>/extensions/, so `pi update` / npm upgrades do not overwrite it.
 *
 * Usage: edit this file and run /reload in pi.
 * To restore the built-in header: rename/delete this file and /reload.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { rawKeyHint } from "@earendil-works/pi-coding-agent";

/**
 * Ultimate Pi logo. Matches the terminal art (256-color amber/gold/white).
 * Set NO_COLOR=1 for monochrome output.
 */
function logoColors() {
	if (!process.stdout.isTTY || process.env.NO_COLOR) {
		return { amber: "", gold: "", white: "", dim: "", reset: "" };
	}
	return {
		amber: "\x1b[38;5;214m",
		gold: "\x1b[38;5;220m",
		white: "\x1b[97m",
		dim: "\x1b[38;5;245m",
		reset: "\x1b[0m",
	};
}

function buildHeader(_theme: Theme): string {
	const { amber, gold, white, dim, reset } = logoColors();

	const logo = [
		"",
		`${amber}   >_  ${white}THE ULTIMATE${reset}  ${gold}PI${reset}`,
		`${amber}   ███████████████████████████╗${reset}`,
		`${gold}   ╚══██████╔════════██████╔══╝${reset}`,
		`${white}      ██████║        ██████║${reset}`,
		`${white}      ██████║        ██████║${reset}`,
		`${white}      ██████║        ██████║${reset}`,
		`${white}      ██████║        ██████║${reset}`,
		`${white}      ██████║        ██████║${reset}`,
		`${white}      ██████║        ██████║${reset}`,
		`${gold}   ████████████╗  ████████████╗${reset}`,
		`${amber}   ╚═══════════╝  ╚═══════════╝${reset}`,
		`${dim}              Multi-agent routing for the Pi CLI.${reset}`,
		"",
	].join("\n");

	// ── Keybinding hints ─────────────────────────────────
	// Built but not shown (same as before). Uncomment the return below to restore.
	const hints = [
		rawKeyHint("escape", "to interrupt"),
		rawKeyHint("ctrl+c", "to clear"),
		rawKeyHint("ctrl+c twice", "to exit"),
		rawKeyHint("ctrl+d", "to exit (empty)"),
		rawKeyHint("ctrl+z", "to suspend"),
		rawKeyHint("ctrl+k", "to delete to end"),
		rawKeyHint("shift+tab", "to cycle thinking level"),
		rawKeyHint("ctrl+p/shift+ctrl+p", "to cycle models"),
		rawKeyHint("ctrl+l", "to select model"),
		rawKeyHint("ctrl+o", "to expand tools"),
		rawKeyHint("ctrl+t", "to expand thinking"),
		rawKeyHint("ctrl+g", "for external editor"),
		rawKeyHint("/", "for commands"),
		rawKeyHint("!", "to run bash"),
		rawKeyHint("!!", "to run bash (no context)"),
		rawKeyHint("alt+enter", "to queue follow-up"),
		rawKeyHint("alt+up", "to edit all queued messages"),
		rawKeyHint(process.platform === "win32" ? "alt+v" : "ctrl+v", "to paste image"),
		rawKeyHint("drop files", "to attach"),
	];
	void hints;

	// return `${logo}\n${hints.join("\n")}`;
	return logo;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setHeader((_tui, theme) => ({
			render(_width: number): string[] {
				return buildHeader(theme).split("\n");
			},
			invalidate() {},
		}));
	});

	pi.registerCommand("builtin-header", {
		description: "Restore the built-in startup header",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});
}
