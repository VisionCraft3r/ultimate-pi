/**
 * Custom Header Extension
 *
 * Replaces the built-in startup header. This file lives in
 * <agentDir>/extensions/, so `pi update` / npm upgrades do not overwrite it.
 *
 * Usage: edit this file and run /reload in pi.
 * To restore the built-in header: rename/delete this file and /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

function buildHeader(): string {
	const { amber, gold, white, dim, reset } = logoColors();

	return [
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
}

const HEADER_LINES = buildHeader().split("\n");

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setHeader(() => ({
			render(): string[] {
				return HEADER_LINES;
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
