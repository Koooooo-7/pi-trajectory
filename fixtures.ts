import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const at = "2026-11-08T10:00:00.000Z";

export function entry(
	id: string,
	parentId: string | null,
	type: string,
	fields: Record<string, unknown> = {},
) {
	return { id, parentId, type, timestamp: at, ...fields };
}

export function session(
	id = "parent",
	cwd = "/project",
	entries: unknown[] = [],
	extra: Record<string, unknown> = {},
): string {
	return `${[{ type: "session", version: 3, id, timestamp: at, cwd, ...extra }, ...entries]
		.map((row) => JSON.stringify(row))
		.join("\n")}\n`;
}

export const trajectoryEntries = [
	entry("u1", null, "message", {
		message: { role: "user", content: "Find promotion availability" },
	}),
	entry("a1", "u1", "message", {
		message: {
			role: "assistant",
			model: "test-model",
			stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: "Inspect both plans" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "plan.json" } },
			],
		},
	}),
	entry("t1", "a1", "message", {
		message: {
			role: "toolResult",
			toolName: "read",
			toolCallId: "call-1",
			content: [{ type: "text", text: "promotion: available" }],
			isError: false,
		},
	}),
	entry("abandoned", "t1", "message", {
		message: { role: "assistant", content: "Old abandoned answer" },
	}),
	entry("u2", "t1", "message", { message: { role: "user", content: "Verify the second plan" } }),
	entry("compact", "u2", "compaction", {
		summary: "Inspected first plan",
		firstKeptEntryId: "u2",
		tokensBefore: 2000,
	}),
	entry("a2", "compact", "message", {
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Second plan verified" }],
			stopReason: "stop",
		},
	}),
];

export async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-trajectory-test-"));
	const dir = join(root, "sessions", "--project--");
	await mkdir(dir, { recursive: true });
	const parent = join(dir, "parent.jsonl");
	await writeFile(parent, session("parent", "/project", trajectoryEntries));
	return { root, dir, parent };
}
