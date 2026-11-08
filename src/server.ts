import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SessionCatalog } from "./catalog.ts";

export interface TrajectoryServer {
	url: string;
	readonly running: boolean;
	urlForSession(path: string | undefined): string;
	stop(): Promise<void>;
}

export interface TrajectoryServerOptions {
	agentDir: string;
	sessionDir?: string;
}

export async function startTrajectoryServer(
	options: TrajectoryServerOptions,
): Promise<TrajectoryServer> {
	const catalog = new SessionCatalog(options.agentDir, options.sessionDir);
	const assets = new Map(
		await Promise.all(
			[
				["/", "viewer.html", "text/html; charset=utf-8"],
				["/viewer.js", "viewer.js", "text/javascript; charset=utf-8"],
				["/branch.js", "branch.js", "text/javascript; charset=utf-8"],
				["/viewer.css", "viewer.css", "text/css; charset=utf-8"],
			].map(
				async ([route = "", file = "", type = ""]) =>
					[route, { body: await readFile(new URL(file, import.meta.url)), type }] as const,
			),
		),
	);
	const token = randomBytes(32).toString("hex");
	let origin = "";
	let stopping: Promise<void> | undefined;
	const server = createServer((request, response) => {
		void handle(request, response).catch((error: unknown) => {
			if (!response.headersSent)
				send(response, 400, {
					error: error instanceof Error ? error.message : "Cannot read session.",
				});
			else response.end();
		});
	});
	server.requestTimeout = 30_000;
	server.headersTimeout = 10_000;
	server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
	function send(response: ServerResponse, status: number, value: unknown): void {
		response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
		response.end(JSON.stringify(value));
	}
	function authorized(request: IncomingMessage): boolean {
		const candidate = request.headers["x-trajectory-token"];
		return (
			typeof candidate === "string" &&
			/^[a-f0-9]{64}$/.test(candidate) &&
			timingSafeEqual(Buffer.from(candidate), Buffer.from(token))
		);
	}
	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("Referrer-Policy", "no-referrer");
		response.setHeader("X-Content-Type-Options", "nosniff");
		response.setHeader(
			"Content-Security-Policy",
			"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
		);
		if (
			request.headers.host !== new URL(origin).host ||
			(request.headers.origin !== undefined && request.headers.origin !== origin)
		) {
			send(response, 403, { error: "This viewer accepts same-origin loopback requests only." });
			return;
		}
		const url = new URL(request.url ?? "/", origin);
		const asset = assets.get(url.pathname);
		if (asset && request.method === "GET") {
			response.writeHead(200, { "Content-Type": asset.type });
			response.end(asset.body);
			return;
		}
		if (!url.pathname.startsWith("/api/")) {
			send(response, 404, { error: "Not found." });
			return;
		}
		if (!authorized(request)) {
			send(response, 403, {
				error: "Missing or invalid viewer capability. Open the complete plugin URL.",
			});
			return;
		}
		if (url.pathname === "/api/stop" && request.method === "POST") {
			send(response, 200, { stopped: true });
			void stop();
			return;
		}
		if (url.pathname === "/api/stop") {
			send(response, 405, { error: "Stop requires POST." });
			return;
		}
		if (request.method !== "GET") {
			send(response, 405, { error: "Method not allowed." });
			return;
		}
		if (url.pathname === "/api/sessions") {
			send(response, 200, await catalog.refresh());
		} else if (url.pathname === "/api/session") {
			const key = url.searchParams.get("key");
			if (!key || !/^[a-f0-9]{24}$/.test(key)) throw new Error("Invalid session key.");
			send(response, 200, await catalog.read(key, url.searchParams.get("revision") ?? undefined));
		} else {
			send(response, 404, { error: "Not found." });
		}
	}
	function stop(): Promise<void> {
		stopping ??= new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeIdleConnections();
		});
		return stopping;
	}
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		await stop();
		throw new Error("Could not determine the loopback viewer port.");
	}
	origin = `http://127.0.0.1:${address.port}`;
	server.unref();
	const url = `${origin}/#token=${token}`;
	return {
		url,
		get running() {
			return server.listening;
		},
		urlForSession: (path) => (path ? `${url}&session=${catalog.keyForPath(path)}` : url),
		stop,
	};
}
