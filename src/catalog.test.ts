import { expect, test } from "bun:test";
import { appendFile, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { entry, fixture, session } from "../fixtures.ts";
import { MAX_SESSION_BYTES, SessionCatalog } from "./catalog.ts";

test("discovers current, default and delegation sessions; ignores sidecars and symlinks", async () => {
	const { root, dir, parent } = await fixture();
	try {
		const children = join(root, "delegation", "workspace-1", "parent");
		await mkdir(children, { recursive: true });
		await writeFile(
			join(children, "child.jsonl"),
			session("child", "/project", [
				entry("c1", null, "message", { message: { role: "user", content: "Review" } }),
			]),
		);
		await writeFile(join(dir, "sidecar.jsonl"), '{"type":"not-a-session"}\n');
		await symlink(parent, join(dir, "linked.jsonl"));
		const catalog = new SessionCatalog(root, dir);
		const data = await catalog.refresh();
		expect(data.sessions).toHaveLength(2);
		const parentSummary = data.sessions.find((item) => item.id === "parent");
		const childSummary = data.sessions.find((item) => item.id === "child");
		if (!parentSummary || !childSummary) throw new Error("Expected parent and child fixtures.");
		expect(childSummary?.parentKey).toBe(parentSummary?.key);
		expect(parentSummary.children).toEqual([childSummary.key]);
		expect(data.issues).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("reads changed records, returns no unchanged payload, and notices a completed torn line", async () => {
	const { root, parent } = await fixture();
	try {
		const catalog = new SessionCatalog(root);
		const key = catalog.keyForPath(parent);
		const first = await catalog.read(key);
		expect(first.trajectory?.entries).toHaveLength(7);
		expect((await catalog.read(key, first.revision)).trajectory).toBeUndefined();
		await appendFile(parent, '{"id":"u3","parentId":"a2",');
		const torn = await catalog.read(key, first.revision);
		expect(torn.trajectory?.issues.at(-1)?.message).toContain("Incomplete final");
		await appendFile(
			parent,
			'"type":"message","message":{"role":"user","content":"NEW_PROMPT"}}\n',
		);
		const complete = await catalog.read(key, torn.revision);
		expect(complete.trajectory?.entries).toHaveLength(8);
		expect(complete.trajectory?.issues).toHaveLength(0);
		await catalog.refresh(true);
		expect((await catalog.refresh()).sessions[0]?.entries).toBe(8);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("supports explicit parentSession paths and refuses undiscovered or oversized files", async () => {
	const { root, parent, dir } = await fixture();
	try {
		await writeFile(
			join(dir, "fork.jsonl"),
			session("fork", "/project", [], { parentSession: parent }),
		);
		const catalog = new SessionCatalog(root);
		const data = await catalog.refresh();
		expect(data.sessions.find((item) => item.id === "fork")?.parentKey).toBe(
			catalog.keyForPath(parent),
		);
		await expect(catalog.read(catalog.keyForPath("/etc/passwd"))).rejects.toThrow("discovered");
		const oversized = join(dir, "huge.jsonl");
		await writeFile(oversized, "");
		await truncate(oversized, MAX_SESSION_BYTES + 1);
		expect((await catalog.refresh(true)).issues.join(" ")).toContain("64 MiB");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
