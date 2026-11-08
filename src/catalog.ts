import { createHash } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseTrajectory, type Trajectory } from "./trajectory.ts";

export const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 10_000;

export interface SessionSummary {
	key: string;
	id: string;
	name: string;
	cwd: string;
	timestamp: string;
	modified: number;
	bytes: number;
	entries: number;
	parentKey?: string;
	children: string[];
	issueCount: number;
}

interface CatalogRecord {
	path: string;
	revision: string;
	summary: SessionSummary;
	parent?: string;
}

interface SessionRead {
	revision: string;
	trajectory?: Trajectory;
}

export interface CatalogSnapshot {
	sessions: SessionSummary[];
	issues: string[];
}

function within(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function readSession(
	path: string,
): Promise<{ text: string; revision: string; modified: number; bytes: number }> {
	const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const stat = await file.stat();
		if (!stat.isFile()) throw new Error("Not a regular file.");
		if (stat.size > MAX_SESSION_BYTES) throw new Error("Session exceeds the 64 MiB read limit.");
		const buffer = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < buffer.length) {
			const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		return {
			text: buffer.subarray(0, offset).toString("utf8"),
			revision: `${stat.mtimeMs}:${stat.size}`,
			modified: stat.mtimeMs,
			bytes: stat.size,
		};
	} finally {
		await file.close();
	}
}

export class SessionCatalog {
	private records = new Map<string, CatalogRecord>();
	private flight: Promise<CatalogSnapshot> | undefined;
	private lastRefresh = 0;
	private snapshot: CatalogSnapshot = { sessions: [], issues: [] };
	private selected: { key: string; revision: string; trajectory: Trajectory } | undefined;
	private readQueue = Promise.resolve();

	constructor(
		private agentDir: string,
		private sessionDir?: string,
	) {}

	refresh(force = false): Promise<CatalogSnapshot> {
		if (this.flight) return this.flight;
		if (!force && Date.now() - this.lastRefresh < 2000) return Promise.resolve(this.snapshot);
		this.flight = this.scan().finally(() => {
			this.flight = undefined;
		});
		return this.flight;
	}

	keyForPath(path: string): string {
		let canonical = resolve(path);
		try {
			canonical = realpathSync(path);
		} catch {
			try {
				canonical = join(realpathSync(dirname(path)), basename(path));
			} catch {
				canonical = resolve(path);
			}
		}
		return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
	}

	read(key: string, revision?: string): Promise<SessionRead> {
		const result = this.readQueue.then(() => this.readSelected(key, revision));
		this.readQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private async readSelected(key: string, revision?: string): Promise<SessionRead> {
		await this.refresh();
		const record = this.records.get(key);
		if (!record) throw new Error("Session is not in the discovered catalogue.");
		const stat = await lstat(record.path);
		if (!stat.isFile()) throw new Error("Session is not a regular file.");
		const current = `${stat.mtimeMs}:${stat.size}`;
		if (current === revision) return { revision: current };
		if (this.selected?.key === key && this.selected.revision === current)
			return { revision: current, trajectory: this.selected.trajectory };
		const data = await readSession(record.path);
		const trajectory = parseTrajectory(data.text);
		this.selected = { key, revision: data.revision, trajectory };
		return { revision: data.revision, trajectory };
	}

	private async scan(): Promise<CatalogSnapshot> {
		const files = new Set<string>();
		const issues: string[] = [];
		const roots = [
			{ path: join(this.agentDir, "sessions"), depth: 1 },
			{ path: join(this.agentDir, "delegation"), depth: 4 },
			...(this.sessionDir ? [{ path: this.sessionDir, depth: 0 }] : []),
		];
		const walk = async (path: string, depth: number): Promise<void> => {
			const entries = await readdir(path, { withFileTypes: true });
			for (const entry of entries) {
				if (files.size >= MAX_FILES) throw new Error("Discovery reached the 10,000-file limit.");
				const child = join(path, entry.name);
				if (entry.isFile() && entry.name.endsWith(".jsonl")) files.add(child);
				else if (entry.isDirectory() && depth > 0) await walk(child, depth - 1);
			}
		};
		for (const root of roots) {
			try {
				await walk(await realpath(root.path), root.depth);
			} catch (error) {
				if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
					issues.push(
						`Could not scan ${root.path}: ${error instanceof Error ? error.message : String(error)}`,
					);
			}
		}
		const next = new Map<string, CatalogRecord>();
		const delegation = await realpath(join(this.agentDir, "delegation")).catch(() =>
			join(resolve(this.agentDir), "delegation"),
		);
		for (const path of files) {
			const key = this.keyForPath(path);
			try {
				const stat = await lstat(path);
				const revision = `${stat.mtimeMs}:${stat.size}`;
				const previous = this.records.get(key);
				if (previous?.revision === revision) {
					next.set(key, previous);
					continue;
				}
				const data = await readSession(path);
				let trajectory: Trajectory;
				try {
					trajectory = parseTrajectory(data.text);
				} catch (error) {
					if (error instanceof Error && error.message.startsWith("Not a pi session:")) continue;
					throw error;
				}
				const { header } = trajectory;
				const lineage =
					within(path, delegation) && !path.split(sep).includes(".resources")
						? basename(dirname(path))
						: undefined;
				const parent = typeof header.parentSession === "string" ? header.parentSession : lineage;
				next.set(key, {
					path,
					revision: data.revision,
					...(parent ? { parent } : {}),
					summary: {
						key,
						id: header.id,
						name: trajectory.title || trajectory.firstPrompt || "Untitled session",
						cwd: header.cwd,
						timestamp: typeof header.timestamp === "string" ? header.timestamp : "",
						modified: data.modified,
						bytes: data.bytes,
						entries: trajectory.entries.length,
						children: [],
						issueCount: trajectory.issues.length,
					},
				});
			} catch (error) {
				issues.push(`${basename(path)}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		const byId = new Map([...next.values()].map((record) => [record.summary.id, record]));
		for (const record of next.values()) {
			record.summary = { ...record.summary, children: [] };
			delete record.summary.parentKey;
		}
		for (const record of next.values()) {
			if (!record.parent) continue;
			const parent =
				byId.get(record.parent) ??
				next.get(this.keyForPath(resolve(dirname(record.path), record.parent)));
			if (parent && parent !== record) {
				record.summary.parentKey = parent.summary.key;
				parent.summary.children.push(record.summary.key);
			}
		}
		this.records = next;
		this.lastRefresh = Date.now();
		this.snapshot = {
			sessions: [...next.values()]
				.map((record) => record.summary)
				.sort((a, b) => b.modified - a.modified),
			issues,
		};
		return this.snapshot;
	}
}
