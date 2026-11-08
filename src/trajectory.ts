export type JsonRecord = Record<string, unknown>;

export interface TrajectoryEntry {
	id: string;
	parentId: string | null;
	type: string;
	timestamp: string;
	line: number;
	record: JsonRecord;
}

export interface TrajectoryIssue {
	line: number;
	message: string;
}

export interface Trajectory {
	header: JsonRecord & { id: string; cwd: string };
	entries: TrajectoryEntry[];
	leaves: string[];
	issues: TrajectoryIssue[];
	title: string;
	firstPrompt: string;
}

export function jsonRecord(value: unknown): JsonRecord | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}

export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item: unknown) => {
			const block = jsonRecord(item);
			return block?.type === "text" && typeof block.text === "string" ? block.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function displayValue(value: unknown, depth = 0): unknown {
	if (depth > 40) return "[Nested data omitted: depth limit]";
	if (Array.isArray(value)) return value.map((item: unknown) => displayValue(item, depth + 1));
	const object = jsonRecord(value);
	if (!object) return value;
	return Object.fromEntries(
		Object.entries(object).map(([key, item]) => [
			key,
			(key === "data" && (object.type === "image" || typeof object.mimeType === "string")) ||
			key === "base64"
				? `[Binary payload omitted${typeof item === "string" ? `: ${item.length} characters` : ""}]`
				: displayValue(item, depth + 1),
		]),
	);
}

export function parseTrajectory(jsonl: string): Trajectory {
	const lines = jsonl.replace(/^\uFEFF/, "").split("\n");
	const issues: TrajectoryIssue[] = [];
	const entries: TrajectoryEntry[] = [];
	let header: Trajectory["header"] | undefined;
	let title = "";
	let firstPrompt = "";
	const ids = new Set<string>();
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			issues.push({
				line: index + 1,
				message:
					index === lines.length - 1
						? "Incomplete final JSON line; waiting for the next write."
						: "Invalid JSON record.",
			});
			continue;
		}
		const record = jsonRecord(value);
		if (!header) {
			if (
				record?.type !== "session" ||
				typeof record.id !== "string" ||
				typeof record.cwd !== "string"
			)
				throw new Error("Not a pi session: the first readable record must be a session header.");
			if (record.version !== 3)
				throw new Error(`Unsupported pi session version: ${record.version}.`);
			header = { ...record, id: record.id, cwd: record.cwd };
			continue;
		}
		if (
			!record ||
			typeof record.id !== "string" ||
			typeof record.type !== "string" ||
			(record.parentId !== null && typeof record.parentId !== "string") ||
			ids.has(record.id)
		) {
			issues.push({ line: index + 1, message: "Invalid or duplicate entry identity / parentId." });
			continue;
		}
		ids.add(record.id);
		if (record.type === "session_info" && typeof record.name === "string") title = record.name;
		const message = jsonRecord(record.message);
		if (!firstPrompt && message?.role === "user")
			firstPrompt = contentText(message.content).replace(/\s+/g, " ").trim().slice(0, 160);
		entries.push({
			id: record.id,
			parentId: record.parentId,
			type: record.type,
			timestamp: typeof record.timestamp === "string" ? record.timestamp : "",
			line: index + 1,
			record: jsonRecord(displayValue(record)) ?? {},
		});
	}
	if (!header) throw new Error("No pi session header found.");
	const parents = new Set(entries.flatMap((entry) => (entry.parentId ? [entry.parentId] : [])));
	for (const entry of entries) {
		if (entry.parentId && !ids.has(entry.parentId))
			issues.push({ line: entry.line, message: `Missing parent entry: ${entry.parentId}.` });
	}
	return {
		header,
		entries,
		leaves: entries.filter((entry) => !parents.has(entry.id)).map((entry) => entry.id),
		issues,
		title,
		firstPrompt,
	};
}
