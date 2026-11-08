---
id: module-pi-trajectory
type: module-design
status: draft
title: Portable pi trajectory viewer
tags: [pi-extension, trajectory]
---

## Responsibility

A standalone pi plugin that opens an offline, loopback-only browser viewer for existing session JSONL.
It requires no ThinkRail registry entry, host changes, credentials, provider calls, or second runtime.

## Surface and boundary

`index.ts` is the public barrel and default extension factory. It exports `createTrajectoryExtension`,
`startTrajectoryServer`, `SessionCatalog`, `parseTrajectory`, `trajectoryBranch`, and their types.
The package manifest exposes the factory through `pi.extensions`; browser HTML/JS/CSS are private
assets loaded relative to the server module. Dependencies are Node builtins, the pi SDK and TypeBox
peers only. No imports from ThinkRail host, contracts, UI, or other extensions.

`/trajectory` starts/reuses the viewer and emits its link; `/trajectory stop` closes it. The
`trajectory_viewer` tool offers the same actions without returning transcript contents to the model.
The listener is created only on explicit use, not at extension registration or session start. Closing
the viewer's server, stopping, or extension shutdown releases its listener; restart creates a new port
and capability. Browser launch is best-effort, never a prerequisite for starting or printing the link.
The launch command emits a pi-owned link notice and a tool call has pi's normal persisted result;
the reader itself never writes or rewrites inspected JSONL. Those links are local access capabilities,
so an invoking chat's usual persistence/context rules still apply to them.

## Read model

Discover the SDK's configured sessions root and the current session directory, plus pi delegation
directories under the configured agent directory. Enumerate asynchronously, avoid following nested
symlinks, and read changed files only. Catalogue identity is a file-derived opaque key, not a URL path.
Only discovered files can be fetched; a session header is required, and sidecar JSONL is excluded.
Metadata derives from stored headers, names, first prompts and explicit lineage, not inferred task text.

Read JSONL version 3 as diagnostic records. Preserve system/usage/custom/context-edit/compaction
entries and abandoned branches. Following `parentId` selects a branch, **not** the currently effective
model context: old messages before compaction remain visible, and compaction's summary/cut point are
shown explicitly. Expose invalid lines, dangling parents, cycles and unsupported versions as diagnostics;
an incomplete final line is retried on the next disk update. Do not silently present a broken chain as
complete. Parent/child links use stored `parentSession` or delegation lineage; missing children are not
invented. JSON fields unknown to the viewer remain inspectable.

Read bounds protect the in-process host: 64 MiB per session, explicit errors above the bound, bounded
discovery depth/count, one catalogue refresh and one selected-session read in flight. The viewer refreshes
from finalized disk records, not streaming token events. Hidden pages pause polling. Unchanged versions
return no new payload; UI selection and disclosure state survive refreshes.

## Browser and security

The browser provides a session list, latest/explicit/all-branch views, searchable timeline, role/tool/error
filters, collapsible raw records, parent/child navigation, live pause/resume and Stop server. Timestamps,
models, usage and duration are displayed only when recorded; no cost or agent-state reconstruction.

Bind `127.0.0.1` on port 0. A cryptographically random capability lives in the URL fragment, not query
strings, logs or referrers. APIs require it in a header and validate Host/Origin. Stop additionally needs
POST. There is no arbitrary-file, upload or execution API, no CORS, no CDN, no analytics. Content uses
DOM text nodes, not HTML interpolation. Image/base64 fields are omitted with explicit markers; text and
code are not redacted, so users must review before sharing. The browser displays transcript content,
not a full provider-request log.

## Verification

Disposable fixtures cover parsing, branch history and errors, current-directory/delegation discovery,
incremental freshness, parent/child links, unauthorized requests, static-route allowlisting, stop/restart
and extension registration. A provider-free browser probe covers searching, filtering, branch changes,
child navigation and append refresh. Verify raw-TypeScript loading under Bun and vanilla pi's Node
loader when the SDK dependencies are available; no host runtime or registry modification is needed.
Unit tests stay provider- and browser-free; `test:browser` is the on-demand Playwright probe, and
`test:node` exercises raw TypeScript with jiti under Node, including packaged browser assets.
