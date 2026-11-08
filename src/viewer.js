import { trajectoryBranch } from "./branch.js";

const $ = (id) => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get("token") || "";
let selectedKey = fragment.get("session") || "";
let sessions = [];
let trajectory;
let revision = "";
let live = true;
let stopped = false;
let busy = false;
let epoch = 0;
let timer;
let limit = 100;
const opened = new Set();

function node(tag, text, className) {
	const element = document.createElement(tag);
	if (text !== undefined) element.textContent = String(text);
	if (className) element.className = className;
	return element;
}

function time(value) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString();
}

async function api(path, method = "GET") {
	const response = await fetch(path, {
		method,
		headers: { "x-trajectory-token": token },
		cache: "no-store",
	});
	const data = await response.json();
	if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
	return data;
}

function status(message, error = false) {
	$("status").textContent = message;
	$("status").classList.toggle("danger", error);
}

function currentSession() {
	return sessions.find((session) => session.key === selectedKey);
}

function renderSessions() {
	const query = $("session-search").value.toLocaleLowerCase();
	$("session-count").textContent = sessions.length;
	$("sessions").replaceChildren();
	for (const session of sessions) {
		if (!`${session.name} ${session.cwd} ${session.id}`.toLocaleLowerCase().includes(query))
			continue;
		const button = node("button", undefined, "session");
		button.type = "button";
		button.setAttribute("aria-current", String(session.key === selectedKey));
		button.append(
			node("span", session.name, "session-name"),
			node("span", session.cwd, "session-path"),
		);
		const meta = node("span", undefined, "session-meta");
		meta.append(
			node("span", time(session.modified)),
			node("span", `${session.parentKey ? "↳ Child · " : ""}${session.entries} records`),
		);
		button.append(meta);
		button.addEventListener("click", () => selectSession(session.key));
		$("sessions").append(button);
	}
	if (!$("sessions").childElementCount)
		$("sessions").append(node("div", "No matching sessions.", "empty"));
}

function selectSession(key) {
	if (key === selectedKey && trajectory) return;
	selectedKey = key;
	epoch += 1;
	trajectory = undefined;
	revision = "";
	limit = 100;
	opened.clear();
	$("branch").value = "latest";
	fragment.set("session", key);
	history.replaceState(null, "", `#${fragment}`);
	renderSessions();
	$("timeline").replaceChildren(node("div", "Loading trajectory…", "empty"));
	void refresh();
}

function contentText(content) {
	if (typeof content === "string") return content;
	return Array.isArray(content)
		? content
				.filter((block) => block?.type === "text")
				.map((block) => block.text || "")
				.join("\n")
		: "";
}

function disclosure(entryId, title, text, index) {
	const details = node("details");
	const key = `${selectedKey}:${entryId}:${index}`;
	details.open = opened.has(key);
	details.append(node("summary", title), node("pre", text));
	details.addEventListener("toggle", () => {
		if (!details.isConnected) return;
		if (details.open) opened.add(key);
		else opened.delete(key);
	});
	return details;
}

function messageBlocks(message) {
	return Array.isArray(message?.content)
		? message.content.filter(
				(block) => block !== null && typeof block === "object" && !Array.isArray(block),
			)
		: [];
}

function entryKind(entry) {
	const role = entry.record.message?.role;
	return entry.type === "message" && ["user", "assistant", "toolResult", "system"].includes(role)
		? role
		: "events";
}

function entryTools(entry) {
	const message = entry.record.message;
	return [
		message?.toolName,
		...messageBlocks(message)
			.filter((block) => block.type === "toolCall")
			.map((block) => block.name),
	].filter(Boolean);
}

function isError(entry) {
	const message = entry.record.message;
	return message?.isError === true || ["error", "aborted", "length"].includes(message?.stopReason);
}

function filterEntry(entry) {
	const kind = $("kind").value;
	const blocks = messageBlocks(entry.record.message);
	if (kind === "thinking" || kind === "toolCall") {
		if (!blocks.some((block) => block.type === kind)) return false;
	} else if (kind !== "all" && entryKind(entry) !== kind) return false;
	if ($("tool").value && !entryTools(entry).includes($("tool").value)) return false;
	if ($("errors").checked && !isError(entry)) return false;
	const query = $("search").value.trim().toLocaleLowerCase();
	return (
		!query ||
		query
			.split(/\s+/)
			.every((term) => JSON.stringify(entry.record).toLocaleLowerCase().includes(term))
	);
}

function branchEntries() {
	if ($("branch").value === "all") return { entries: trajectory.entries, issues: [] };
	return trajectoryBranch(
		trajectory,
		$("branch").value === "latest" ? undefined : $("branch").value,
	);
}

function renderEntry(entry) {
	const record = entry.record;
	const message = record.message;
	const kind = entryKind(entry);
	const error = isError(entry);
	const card = node("article", undefined, `entry ${kind}${error ? " error" : ""}`);
	card.dataset.entryId = entry.id;
	const header = node("div", undefined, "entry-header");
	const label =
		kind === "user"
			? "USER"
			: kind === "assistant"
				? "ASSISTANT"
				: kind === "toolResult"
					? `${error ? "ERROR" : "RESULT"} · ${message.toolName || "tool"}`
					: kind === "system"
						? "SYSTEM PROMPT"
						: record.type.replaceAll("_", " ").toUpperCase();
	header.append(
		node("span", label, "entry-label"),
		node("span", entry.id, "entry-id"),
		node("time", time(entry.timestamp), "entry-time"),
	);
	card.append(header);
	const info = [];
	if (message?.model) info.push(message.model);
	if (message?.stopReason) info.push(`stop: ${message.stopReason}`);
	if (typeof message?.durationMs === "number")
		info.push(`${(message.durationMs / 1000).toFixed(2)}s`);
	if (message?.usage)
		info.push(
			`tokens: in ${message.usage.input ?? "?"} / out ${message.usage.output ?? "?"} / cache read ${message.usage.cacheRead ?? "?"}`,
		);
	if (message?.toolCallId) info.push(`call: ${message.toolCallId}`);
	if (info.length) card.append(node("div", info.join(" · "), "entry-info"));
	let section = 0;
	if (kind === "user" || kind === "assistant") {
		const text = contentText(message.content);
		if (text)
			card.append(
				text.length > 1600
					? disclosure(entry.id, "Message · expand full text", text, section++)
					: node("p", text),
			);
		for (const block of messageBlocks(message)) {
			if (block.type === "thinking")
				card.append(
					disclosure(entry.id, "Thinking · returned by model", block.thinking || "", section++),
				);
			else if (block.type === "toolCall")
				card.append(
					disclosure(
						entry.id,
						`Tool call · ${block.name} · ${block.id}`,
						JSON.stringify(block.arguments, null, 2),
						section++,
					),
				);
			else if (block.type === "image")
				card.append(node("p", `Image attachment · ${block.mimeType || "image"} · binary omitted`));
		}
	} else if (kind === "toolResult") {
		const text = contentText(message.content);
		card.append(
			disclosure(
				entry.id,
				`Output · ${text.length.toLocaleString()} characters`,
				text || "No text output. Inspect the raw record for attachments and details.",
				section++,
			),
		);
	} else if (record.type === "compaction" || record.type === "branch_summary") {
		card.append(
			node(
				"p",
				`Historical context summarized · first kept entry: ${record.firstKeptEntryId ?? "none"} · prior tokens: ${record.tokensBefore ?? "unknown"}`,
			),
		);
		card.append(disclosure(entry.id, "Summary", record.summary || "", section++));
	} else if (record.type === "model_change") {
		card.append(node("p", `${record.provider || ""} / ${record.modelId || ""}`));
	} else if (record.type === "custom_message") {
		card.append(
			disclosure(
				entry.id,
				`Extension message · ${record.customType || ""}`,
				contentText(record.content),
				section++,
			),
		);
	}
	card.append(
		disclosure(
			entry.id,
			`Raw JSON record · line ${entry.line} · parent ${entry.parentId ?? "root"}`,
			JSON.stringify(record, null, 2),
			"raw",
		),
	);
	return card;
}

function renderTimeline() {
	if (!trajectory) return;
	const branch = branchEntries();
	const matched = branch.entries.filter(filterEntry);
	$("issues").replaceChildren(
		...[...trajectory.issues, ...branch.issues].map((issue) =>
			node("div", `${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}`),
		),
	);
	$("result-count").textContent =
		`${matched.length} matching / ${branch.entries.length} branch records · persisted history, not effective model context`;
	$("timeline").replaceChildren();
	let turn = 0;
	let shown = 0;
	const matches = new Set(matched.map((entry) => entry.id));
	for (const entry of branch.entries) {
		if (entryKind(entry) === "user") turn += 1;
		if (!matches.has(entry.id)) continue;
		if (shown >= limit) break;
		if (entryKind(entry) === "user") $("timeline").append(node("div", `TURN ${turn}`, "turn"));
		$("timeline").append(renderEntry(entry));
		shown += 1;
	}
	if (!matched.length)
		$("timeline").append(node("div", "No records match these filters.", "empty"));
	$("more").hidden = matched.length <= limit;
	$("more").textContent = `Show next ${Math.min(100, matched.length - limit)} records`;
}

function renderHeader() {
	const session = currentSession();
	$("title").textContent =
		session?.name || trajectory.title || trajectory.firstPrompt || "Untitled session";
	$("workspace").textContent = `${trajectory.header.cwd} · ${trajectory.header.id}`;
	const entries = trajectory.entries;
	const stats = [
		[entries.filter((entry) => entryKind(entry) === "user").length, "prompts"],
		[entries.filter((entry) => entryKind(entry) === "assistant").length, "AI messages"],
		[
			entries.reduce(
				(sum, entry) =>
					sum +
					messageBlocks(entry.record.message).filter((block) => block.type === "toolCall").length,
				0,
			),
			"tool calls",
		],
		[entries.filter(isError).length, "errors / interrupted"],
	];
	$("metrics").replaceChildren(
		...stats.map(([count, label]) => {
			const metric = node("div", undefined, "metric");
			metric.append(node("strong", count), node("span", label));
			return metric;
		}),
	);
	$("relations").replaceChildren();
	for (const key of [session?.parentKey, ...(session?.children || [])].filter(Boolean)) {
		const related = sessions.find((item) => item.key === key);
		if (!related) continue;
		const button = node(
			"button",
			`${key === session.parentKey ? "↑ Parent" : "↳ Child"}: ${related.name}`,
		);
		button.type = "button";
		button.addEventListener("click", () => selectSession(key));
		$("relations").append(button);
	}
	const previousBranch = $("branch").value;
	$("branch").replaceChildren(
		new Option("Latest branch", "latest"),
		new Option("All stored records", "all"),
		...trajectory.leaves.map((leaf) => new Option(`Branch · ${leaf}`, leaf)),
	);
	$("branch").value = [...$("branch").options].some((option) => option.value === previousBranch)
		? previousBranch
		: "latest";
	const previousTool = $("tool").value;
	const tools = [...new Set(entries.flatMap(entryTools))].sort();
	$("tool").replaceChildren(
		new Option("All tools", ""),
		...tools.map((name) => new Option(name, name)),
	);
	$("tool").value = tools.includes(previousTool) ? previousTool : "";
}

async function refresh() {
	if (busy || stopped || document.hidden) return;
	busy = true;
	const generation = epoch;
	try {
		if (!token)
			throw new Error(
				"Open the complete link from /trajectory, including its capability fragment.",
			);
		const catalog = await api("/api/sessions");
		if (generation !== epoch) return;
		sessions = catalog.sessions;
		$("catalog-issues").replaceChildren(...catalog.issues.map((issue) => node("div", issue)));
		if (!selectedKey) selectedKey = sessions[0]?.key || "";
		renderSessions();
		if (selectedKey) {
			const data = await api(
				`/api/session?key=${encodeURIComponent(selectedKey)}&revision=${encodeURIComponent(revision)}`,
			);
			if (generation !== epoch) return;
			if (data.trajectory) {
				trajectory = data.trajectory;
				revision = data.revision;
				renderHeader();
				renderTimeline();
			} else if (trajectory) renderHeader();
		}
		status(live ? "● Live · disk records" : "Paused");
	} catch (error) {
		if (generation === epoch) status(error.message, true);
	} finally {
		busy = false;
		clearTimeout(timer);
		if (!stopped && !document.hidden && (live || generation !== epoch))
			timer = setTimeout(refresh, generation !== epoch ? 0 : 2000);
	}
}

let searchTimer;
$("search").addEventListener("input", () => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		limit = 100;
		renderTimeline();
	}, 180);
});
$("session-search").addEventListener("input", renderSessions);
for (const id of ["kind", "tool", "branch", "errors"])
	$(id).addEventListener("change", () => {
		limit = 100;
		renderTimeline();
	});
$("more").addEventListener("click", () => {
	limit += 100;
	renderTimeline();
});
$("collapse").addEventListener("click", () => {
	opened.clear();
	document.querySelectorAll("details").forEach((details) => {
		details.open = false;
	});
});
$("live").addEventListener("click", () => {
	live = !live;
	$("live").textContent = live ? "Pause live" : "Resume live";
	$("live").setAttribute("aria-pressed", String(live));
	if (live) void refresh();
	else {
		clearTimeout(timer);
		status("Paused");
	}
});
$("stop").addEventListener("click", async () => {
	try {
		await api("/api/stop", "POST");
		stopped = true;
		clearTimeout(timer);
		status("Server stopped");
		$("stop").disabled = true;
		$("live").disabled = true;
	} catch (error) {
		status(error.message, true);
	}
});
document.addEventListener("visibilitychange", () => {
	clearTimeout(timer);
	if (!document.hidden && live) void refresh();
});
void refresh();
