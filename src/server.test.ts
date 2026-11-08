import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { fixture } from "../fixtures.ts";
import { startTrajectoryServer } from "./server.ts";

test("loopback capability protection, route allowlisting and stop", async () => {
	const { root, parent } = await fixture();
	const viewer = await startTrajectoryServer({ agentDir: root });
	const origin = new URL(viewer.url).origin;
	const token = new URLSearchParams(new URL(viewer.url).hash.slice(1)).get("token") ?? "";
	const headers = { "x-trajectory-token": token };
	try {
		expect(new URL(viewer.url).hostname).toBe("127.0.0.1");
		expect(new URL(viewer.url).search).toBe("");
		expect(viewer.urlForSession(parent)).toContain("&session=");
		const page = await fetch(origin);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
		expect(page.headers.get("access-control-allow-origin")).toBeNull();
		expect((await fetch(`${origin}/api/sessions`)).status).toBe(403);
		expect(
			(
				await fetch(`${origin}/api/sessions`, {
					headers: { ...headers, Origin: "https://evil.example" },
				})
			).status,
		).toBe(403);
		expect(
			(await fetch(`${origin}/api/sessions`, { headers: { ...headers, Host: "evil.example" } }))
				.status,
		).toBe(403);
		expect((await fetch(`${origin}/index.ts`)).status).toBe(404);
		expect((await fetch(`${origin}/api/session?key=../../etc/passwd`, { headers })).status).toBe(
			400,
		);
		const catalogue = (await (await fetch(`${origin}/api/sessions`, { headers })).json()) as {
			sessions: { key: string }[];
		};
		expect(catalogue.sessions).toHaveLength(1);
		const result = (await (
			await fetch(`${origin}/api/session?key=${catalogue.sessions[0]?.key}`, { headers })
		).json()) as { trajectory: { entries: unknown[] } };
		expect(result.trajectory.entries).toHaveLength(7);
		expect((await fetch(`${origin}/api/stop`, { headers })).status).toBe(405);
		expect((await fetch(`${origin}/api/stop`, { method: "POST" })).status).toBe(403);
		expect((await fetch(`${origin}/api/stop`, { method: "POST", headers })).status).toBe(200);
		await viewer.stop();
		expect(viewer.running).toBe(false);
		await expect(fetch(origin)).rejects.toThrow();
	} finally {
		await viewer.stop();
		await rm(root, { recursive: true, force: true });
	}
});
