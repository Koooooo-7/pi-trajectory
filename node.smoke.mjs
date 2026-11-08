import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sdkRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { createJiti } = sdkRequire("jiti");
const jiti = createJiti(import.meta.url, {
	tryNative: false,
	moduleCache: false,
	alias: { typebox: sdkRequire.resolve("typebox") },
});
const plugin = await jiti.import(
	process.argv[2] || fileURLToPath(new URL("./index.ts", import.meta.url)),
);
const root = await mkdtemp(join(tmpdir(), "pi-trajectory-node-"));
const sessionDir = join(root, "sessions", "--fixture--");
await mkdir(sessionDir, { recursive: true });
const sessionFile = join(sessionDir, "fixture.jsonl");
await writeFile(
	sessionFile,
	`${JSON.stringify({ type: "session", version: 3, id: "node-fixture", cwd: root })}\n${JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user", content: "Node fixture prompt" } })}\n`,
);
let tool;
let shutdown;
plugin.createTrajectoryExtension({ agentDir: root })({
	registerTool: (value) => {
		tool = value;
	},
	registerCommand: () => {},
	on: (name, handler) => {
		if (name === "session_shutdown") shutdown = handler;
	},
});
assert.equal(tool.name, "trajectory_viewer");
const context = {
	hasUI: false,
	sessionManager: { getSessionFile: () => sessionFile, getSessionDir: () => dirname(sessionFile) },
};
try {
	const started = await tool.execute(
		"node-start",
		{ action: "start" },
		undefined,
		undefined,
		context,
	);
	const url = new URL(started.details.url);
	const token = new URLSearchParams(url.hash.slice(1)).get("token");
	const headers = { "x-trajectory-token": token };
	const sessions = await (await fetch(`${url.origin}/api/sessions`, { headers })).json();
	assert.equal(sessions.sessions.length, 1);
	const transcript = await (
		await fetch(`${url.origin}/api/session?key=${sessions.sessions[0].key}`, { headers })
	).json();
	assert.equal(transcript.trajectory.firstPrompt, "Node fixture prompt");
	assert.equal((await fetch(`${url.origin}/viewer.js`)).status, 200);
	await tool.execute("node-stop", { action: "stop" }, undefined, undefined, context);
	await assert.rejects(fetch(url.origin));
	console.log(
		"Trajectory Node/jiti smoke passed: raw TypeScript, bundled assets, discovery, read and stop.",
	);
} finally {
	await shutdown();
	await rm(root, { recursive: true, force: true });
}
