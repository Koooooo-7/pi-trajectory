import type { Trajectory, TrajectoryEntry, TrajectoryIssue } from "./trajectory.ts";

export function trajectoryBranch(
	trajectory: Trajectory,
	leafId?: string,
): { entries: TrajectoryEntry[]; issues: TrajectoryIssue[] };
