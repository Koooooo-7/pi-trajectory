import { describe, expect, test } from "bun:test";
import { entry, session, trajectoryEntries } from "../fixtures.ts";
import { trajectoryBranch } from "./branch.js";
import { parseTrajectory } from "./trajectory.ts";

describe("JSONL diagnostic read model", () => {
	test("preserves abandoned entries and pre-compaction history while resolving a branch", () => {
		const trajectory = parseTrajectory(session("parent", "/project", trajectoryEntries));
		expect(trajectory.entries).toHaveLength(7);
		expect(trajectory.leaves).toEqual(["abandoned", "a2"]);
		expect(trajectoryBranch(trajectory).entries.map((row) => row.id)).toEqual([
			"u1",
			"a1",
			"t1",
			"u2",
			"compact",
			"a2",
		]);
		expect(trajectoryBranch(trajectory, "abandoned").entries.at(-1)?.id).toBe("abandoned");
		expect(trajectory.firstPrompt).toBe("Find promotion availability");
	});
	test("keeps raw system, usage and unknown records; omits image payloads", () => {
		const trajectory = parseTrajectory(
			session("p", "/p", [
				entry("s", null, "message", {
					message: { role: "system", sections: { tools: "all tools" } },
				}),
				entry("i", "s", "message", {
					message: {
						role: "user",
						content: [{ type: "image", mimeType: "image/png", data: "SECRET_BASE64" }],
					},
				}),
				entry("usage", "i", "usage", { usage: { input: 10, output: 20 } }),
				entry("unknown", "usage", "future_record", { value: "retained" }),
			]),
		);
		expect(JSON.stringify(trajectory)).not.toContain("SECRET_BASE64");
		expect(JSON.stringify(trajectory)).toContain("Binary payload omitted");
		expect(trajectory.entries.at(-1)?.record.value).toBe("retained");
	});
	test("reports invalid/torn lines, duplicate ids, dangling parents and cycles", () => {
		const text = `${session("p", "/p", [
			entry("x", "missing", "custom"),
			entry("x", null, "custom"),
			entry("cycle", "cycle", "custom"),
		])}bad json\n{"type":`;
		const trajectory = parseTrajectory(text);
		expect(trajectory.issues.map((issue) => issue.message).join(" ")).toContain("Incomplete final");
		expect(trajectory.issues.map((issue) => issue.message).join(" ")).toContain("Missing parent");
		expect(trajectoryBranch(trajectory, "cycle").issues).toHaveLength(1);
		expect(trajectoryBranch(trajectory, "does-not-exist").issues).toHaveLength(1);
	});
	test("requires a real version-3 header and uses the latest name including clears", () => {
		expect(() => parseTrajectory('{"type":"sidecar"}\n')).toThrow("Not a pi session");
		expect(() => parseTrajectory('{"type":"session","id":"p","cwd":"/p","version":4}\n')).toThrow(
			"Unsupported",
		);
		const trajectory = parseTrajectory(
			session("p", "/p", [
				entry("n1", null, "session_info", { name: "Named" }),
				entry("n2", "n1", "session_info", { name: "" }),
			]),
		);
		expect(trajectory.title).toBe("");
	});
});
