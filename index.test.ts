import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { fixture } from "./fixtures.ts";
import defaultFactory, { createTrajectoryExtension } from "./index.ts";

interface CapturedTool {
	name: string;
	execute(
		id: string,
		params: { action: "start" | "stop"; openBrowser?: boolean },
		signal: AbortSignal | undefined,
		update: undefined,
		ctx: ExtensionContext,
	): Promise<{
		content: { type: string; text?: string }[];
		details: { url?: string; stopped?: boolean };
	}>;
}

function capture(factory: ExtensionFactory) {
	let tool: CapturedTool | undefined;
	let command: { handler(args: string, ctx: ExtensionContext): Promise<void> } | undefined;
	let shutdown: (() => Promise<void>) | undefined;
	const messages: unknown[] = [];
	const fake = {
		registerTool: (value: CapturedTool) => {
			tool = value;
		},
		registerCommand: (_name: string, value: typeof command) => {
			command = value;
		},
		on: (name: string, handler: () => Promise<void>) => {
			if (name === "session_shutdown") shutdown = handler;
		},
		sendMessage: (value: unknown) => {
			messages.push(value);
		},
	};
	factory(fake as unknown as ExtensionAPI);
	if (!tool || !command || !shutdown) throw new Error("Plugin registrations missing.");
	return { tool, command, shutdown, messages };
}

test("registers lazily, serializes starts/stops, restarts after page stop and shuts down", async () => {
	const { root, parent, dir } = await fixture();
	const opened: string[] = [];
	const plugin = capture(
		createTrajectoryExtension({
			agentDir: root,
			openBrowser: async (url) => {
				opened.push(url);
			},
		}),
	);
	const ctx = {
		sessionManager: { getSessionFile: () => parent, getSessionDir: () => dir },
		hasUI: false,
	} as unknown as ExtensionContext;
	try {
		expect(plugin.tool.name).toBe("trajectory_viewer");
		const [first, second] = await Promise.all([
			plugin.tool.execute("a", { action: "start" }, undefined, undefined, ctx),
			plugin.tool.execute("b", { action: "start" }, undefined, undefined, ctx),
		]);
		expect(first.details.url).toBe(second.details.url);
		const url = first.details.url;
		if (!url) throw new Error("Missing viewer URL.");
		const token = new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? "";
		await fetch(`${new URL(url).origin}/api/stop`, {
			method: "POST",
			headers: { "x-trajectory-token": token },
		});
		await plugin.tool.execute("stop", { action: "stop" }, undefined, undefined, ctx);
		const restarted = await plugin.tool.execute(
			"c",
			{ action: "start", openBrowser: true },
			undefined,
			undefined,
			ctx,
		);
		expect(restarted.details.url).not.toBe(url);
		if (!restarted.details.url) throw new Error("Missing restarted viewer URL.");
		expect(opened).toEqual([restarted.details.url]);
		await plugin.command.handler("", ctx);
		expect(plugin.messages).toHaveLength(1);
		await plugin.shutdown();
		await expect(
			plugin.tool.execute("d", { action: "start" }, undefined, undefined, ctx),
		).rejects.toThrow("shut down");
	} finally {
		await plugin.shutdown();
		await rm(root, { recursive: true, force: true });
	}
});

test("default factory can load without starting a server and stop before start", async () => {
	const plugin = capture(defaultFactory);
	const result = await plugin.tool.execute(
		"stop",
		{ action: "stop" },
		undefined,
		undefined,
		{} as ExtensionContext,
	);
	expect(result.details.stopped).toBe(true);
	await plugin.shutdown();
});
