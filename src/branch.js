export function trajectoryBranch(trajectory, leafId = trajectory.entries.at(-1)?.id) {
	const index = new Map(trajectory.entries.map((entry) => [entry.id, entry]));
	const entries = [];
	const issues = [];
	const seen = new Set();
	let cursor = leafId;
	while (cursor) {
		const entry = index.get(cursor);
		if (!entry || seen.has(cursor)) {
			issues.push({
				line: entry?.line ?? 0,
				message: `Broken branch at ${cursor}: missing entry or cycle.`,
			});
			break;
		}
		seen.add(cursor);
		entries.push(entry);
		cursor = entry.parentId;
	}
	return { entries: entries.reverse(), issues };
}
