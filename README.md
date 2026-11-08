# pi Trajectory

A standalone pi plugin for exploring JSONL session histories in your browser. Works in ThinkRail by
installing a normal pi package: **no ThinkRail source changes or rebuild required**.

## Install this local plugin

In ThinkRail, open **Settings → Extensions → Install**, enter the **absolute path** to this package
(`/path/to/pi-trajectory`, replaced with your plugin's actual location), and select user scope. A local install records the path, so keep
the directory in place. Trust project resources if you choose a project-scoped install.

In vanilla pi:

```sh
pi install /path/to/pi-trajectory
```

This package is not yet published to npm. It uses pi's SDK and TypeBox from the host's extension loader;
its viewer uses only standard Node APIs and bundled HTML/CSS/JavaScript. No browser build or CDN needed.

## Open and stop

Type `/trajectory` in a pi/ThinkRail chat. It starts the viewer, attempts to open your default browser,
and displays a clickable link. The current session is preselected once its JSONL exists.

Alternatively, ask the agent to call:

```json
{"action":"start","openBrowser":true}
```

on the `trajectory_viewer` tool. The result contains the URL, not your session contents. With
`openBrowser` omitted, just open the returned link yourself.

Stop from the page's **Stop server** button, `/trajectory stop`, or the tool with `{"action":"stop"}`.
Stopping does not stop the agent or delete transcripts. Starting again produces a fresh URL.

## Viewer

- **Session list:** names, workspaces, timestamps, and parent/child navigation.
- **Timeline:** user/assistant messages, returned thinking, tool arguments/results, system prompt
  records, usage, model changes, compaction, context edits, and unknown raw records.
- **Branches:** latest branch, a selected leaf, or every stored record. Pre-compaction history stays
  visible; this is diagnostic history, **not** the model's effective context.
- **Search/filter:** record text, role/content kind, tool name and errors/interruption. Long text and
  raw JSON are collapsible; records load into the DOM in batches of 100.
- **Live refresh:** finalized disk records are checked about every two seconds while the page is visible;
  pause/resume is available. It is not token-by-token streaming.

Default discovery covers `<pi agent directory>/sessions`, `<pi agent directory>/delegation`, and the
current session's directory, including a custom session directory. The agent directory comes from pi's
public `getAgentDir()` and respects `PI_CODING_AGENT_DIR`. Custom delegation roots outside these folders
are not automatically discovered. A child appears once its transcript exists and its stored lineage
can be associated with a discovered parent. Broken/missing records are reported rather than invented.

## Privacy and limits

The server binds only `127.0.0.1` on an OS-assigned port. Its API requires the random capability from the
URL fragment, rejects cross-origin requests, and cannot fetch arbitrary filesystem paths. Assets are
offline, content is displayed as text, and there are no analytics or provider calls. Image/base64
payloads are omitted; **prompts, code and tool output are not redacted**. Do not share the link or raw
records without checking sensitive content. On a remote/headless host, localhost refers to that host;
use your own secure tunnel if needed, not a public bind.

The viewer never edits inspected JSONL. Starting it from a chat emits a normal pi link notice/tool
result in that invoking chat, which pi can persist and include in subsequent context. The link is a
local access capability; stopping the server invalidates it.

The server belongs to the extension instance that started it. Normal extension shutdown closes it;
if a host does not emit pi's shutdown event on reload, stop it explicitly before reloading/disabling.
Catalogue discovery is bounded to 10,000 files and limited depth; individual transcripts are limited
to 64 MiB. Version-3 session JSONL is supported. Unsupported versions and malformed/torn records are
reported in the viewer.

## Development

```sh
cd /path/to/pi-trajectory
npm install --ignore-scripts --legacy-peer-deps
bun run test
bun run typecheck
bun run test:browser
bun run test:node
```

Tests use disposable fixtures, never real user transcripts or provider credentials. The optional
browser smoke requires Playwright Chromium (`bunx playwright install chromium --only-shell`).
