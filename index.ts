import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { startTrajectoryServer, type TrajectoryServer } from "./src/server.ts";

export { trajectoryBranch } from "./src/branch.js";
export type { CatalogSnapshot, SessionSummary } from "./src/catalog.ts";
export { SessionCatalog } from "./src/catalog.ts";
export type { TrajectoryServer, TrajectoryServerOptions } from "./src/server.ts";
export { startTrajectoryServer } from "./src/server.ts";
export type { Trajectory, TrajectoryEntry, TrajectoryIssue } from "./src/trajectory.ts";
export { parseTrajectory } from "./src/trajectory.ts";

export interface TrajectoryExtensionOptions {
	agentDir?: string;
	openBrowser?: (url: string) => Promise<void>;
}

async function openBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	const command =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
	const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
	const result = await pi.exec(command, args, { timeout: 5000, maxBuffer: 1024 });
	if (result.code !== 0) throw new Error("Browser opener unavailable.");
}

export function createTrajectoryExtension(
	options: TrajectoryExtensionOptions = {},
): ExtensionFactory {
	return (pi) => {
		let viewer: TrajectoryServer | undefined;
		let pending = Promise.resolve();
		let closed = false;
		function serialize<T>(action: () => Promise<T>): Promise<T> {
			const result = pending.then(action);
			pending = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		}
		async function stop(): Promise<void> {
			const active = viewer;
			viewer = undefined;
			await active?.stop();
		}
		async function start(ctx: ExtensionContext, launch: boolean): Promise<string> {
			if (closed) throw new Error("This trajectory extension has shut down.");
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!viewer?.running) {
				viewer = await startTrajectoryServer({
					agentDir:
						options.agentDir ?? (await import("@earendil-works/pi-coding-agent")).getAgentDir(),
					sessionDir: ctx.sessionManager.getSessionDir(),
				});
			}
			const url = viewer.urlForSession(sessionFile);
			if (launch) {
				try {
					await (options.openBrowser ? options.openBrowser(url) : openBrowser(pi, url));
				} catch {
					if (ctx.hasUI)
						ctx.ui.notify(
							"Browser could not be opened automatically. Open the trajectory link manually.",
							"warning",
						);
				}
			}
			return url;
		}
		pi.registerCommand("trajectory", {
			description: "Open the local JSONL trajectory viewer; use /trajectory stop to close it.",
			handler: async (args, ctx) => {
				if (args.trim() === "stop") {
					await serialize(stop);
					if (ctx.hasUI) ctx.ui.notify("Trajectory viewer stopped.", "info");
					return;
				}
				if (args.trim()) throw new Error("Usage: /trajectory or /trajectory stop");
				const url = await serialize(() => start(ctx, true));
				pi.sendMessage(
					{
						customType: "trajectory-viewer",
						content: `[Open the local trajectory viewer](${url})\n\nRead-only pi JSONL records. Stop from the page or with /trajectory stop.`,
						display: true,
					},
					{ triggerTurn: false },
				);
			},
		});
		pi.registerTool({
			name: "trajectory_viewer",
			label: "Trajectory viewer",
			description:
				"Start or stop a loopback-only, read-only browser viewer of local pi JSONL sessions. Start returns a link; it does not send session contents to the model. Use only when the user asks to inspect trajectories.",
			parameters: Type.Object({
				action: Type.Union([Type.Literal("start"), Type.Literal("stop")]),
				openBrowser: Type.Optional(Type.Boolean()),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (params.action === "stop") {
					await serialize(stop);
					return {
						content: [{ type: "text", text: "Trajectory viewer stopped." }],
						details: { stopped: true },
					};
				}
				_signal?.throwIfAborted();
				const url = await serialize(() => start(ctx, params.openBrowser === true));
				return {
					content: [{ type: "text", text: `[Open trajectory viewer](${url})` }],
					details: { url },
				};
			},
		});
		pi.on("session_shutdown", () => {
			closed = true;
			return serialize(stop);
		});
	};
}

export default createTrajectoryExtension();
