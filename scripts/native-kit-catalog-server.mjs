import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
const DECISIONS_RELATIVE_PATH = path.join("docs", "design", "native-kit-catalog-decisions.json");
const ALLOWED_CHOICES = new Set(["keep", "adjust", "hold"]);

const MIME_TYPES = new Map([
	[".html", "text/html; charset=utf-8"],
	[".css", "text/css; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".webp", "image/webp"],
]);

function normalizeDecisions(input = {}) {
	const choices = {};
	for (const [component, choice] of Object.entries(input.choices ?? {})) {
		if (typeof component === "string" && component.trim() && ALLOWED_CHOICES.has(choice)) {
			choices[component] = choice;
		}
	}

	const counts = { keep: 0, adjust: 0, hold: 0 };
	for (const choice of Object.values(choices)) {
		counts[choice] += 1;
	}

	return {
		schemaVersion: 1,
		updatedAt: new Date().toISOString(),
		theme: input.theme === "dark" ? "dark" : "light",
		density: input.density === "compact" ? "compact" : "comfortable",
		counts,
		choices,
	};
}

function writeJson(response, statusCode, payload) {
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(payload, null, 2));
}

function writeText(response, statusCode, text) {
	response.writeHead(statusCode, {
		"content-type": "text/plain; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(text);
}

function isInside(parent, target) {
	const relative = path.relative(parent, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveStaticPath(repoRoot, requestPath) {
	const pathname = requestPath === "/" ? "/docs/design/native-kit-catalog.html" : requestPath;
	const decodedPath = decodeURIComponent(pathname);
	const normalizedPath = decodedPath.replace(/^\/+/, "").replaceAll("/", path.sep);
	const targetPath = path.resolve(repoRoot, normalizedPath);

	const docsDesignRoot = path.resolve(repoRoot, "docs", "design");
	const brandRoot = path.resolve(repoRoot, "brand");
	if (isInside(docsDesignRoot, targetPath) || isInside(brandRoot, targetPath)) {
		return targetPath;
	}
	return null;
}

async function readRequestJson(request) {
	let body = "";
	for await (const chunk of request) {
		body += chunk;
		if (body.length > 1024 * 1024) {
			throw new Error("Request body is too large.");
		}
	}
	return body ? JSON.parse(body) : {};
}

async function readDecisions(decisionsPath) {
	try {
		const saved = JSON.parse(await readFile(decisionsPath, "utf8"));
		return normalizeDecisions(saved);
	} catch (error) {
		if (error?.code === "ENOENT") {
			return normalizeDecisions();
		}
		throw error;
	}
}

async function writeDecisions(decisionsPath, decisions) {
	await mkdir(path.dirname(decisionsPath), { recursive: true });
	const tempPath = `${decisionsPath}.${process.pid}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
	await rename(tempPath, decisionsPath);
}

function serveStatic(response, filePath) {
	const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
	response.writeHead(200, {
		"content-type": contentType,
		"cache-control": "no-store",
	});
	createReadStream(filePath)
		.on("error", () => writeText(response, 404, "Not found"))
		.pipe(response);
}

async function listenWithFallback(server, host, preferredPort) {
	const startPort = Number(preferredPort);
	const maxAttempts = startPort === 0 ? 1 : 20;

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const port = startPort === 0 ? 0 : startPort + attempt;
		try {
			await new Promise((resolve, reject) => {
				const onError = (error) => {
					server.off("listening", onListening);
					reject(error);
				};
				const onListening = () => {
					server.off("error", onError);
					resolve();
				};
				server.once("error", onError);
				server.once("listening", onListening);
				server.listen(port, host);
			});
			return;
		} catch (error) {
			if (error?.code !== "EADDRINUSE" || attempt === maxAttempts - 1) {
				throw error;
			}
		}
	}
}

export function createNativeKitCatalogServer(options = {}) {
	const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 4177;
	const log = options.log ?? true;
	const decisionsPath = path.resolve(repoRoot, DECISIONS_RELATIVE_PATH);

	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);

			if (url.pathname === "/api/native-kit-catalog-decisions") {
				if (request.method === "GET") {
					writeJson(response, 200, await readDecisions(decisionsPath));
					return;
				}
				if (request.method === "POST") {
					const decisions = normalizeDecisions(await readRequestJson(request));
					await writeDecisions(decisionsPath, decisions);
					writeJson(response, 200, decisions);
					return;
				}
				writeText(response, 405, "Method not allowed");
				return;
			}

			if (request.method !== "GET" && request.method !== "HEAD") {
				writeText(response, 405, "Method not allowed");
				return;
			}

			const filePath = resolveStaticPath(repoRoot, url.pathname);
			if (!filePath) {
				writeText(response, 404, "Not found");
				return;
			}
			serveStatic(response, filePath);
		} catch (error) {
			writeJson(response, 500, { error: error?.message ?? String(error) });
		}
	});

	return {
		async start() {
			await listenWithFallback(server, host, port);
			const address = server.address();
			const actualPort = typeof address === "object" && address ? address.port : port;
			const baseUrl = `http://${host}:${actualPort}`;
			const catalogUrl = `${baseUrl}/docs/design/native-kit-catalog.html`;
			if (log) {
				console.log(`FRIDAY Native Kit catalog: ${catalogUrl}`);
				console.log(`Decisions file: ${decisionsPath}`);
			}
			return {
				url: baseUrl,
				catalogUrl,
				decisionsPath,
				close: () => new Promise((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
				}),
			};
		},
		server,
	};
}

function parseCliArgs(argv) {
	const args = new Map();
	for (let index = 0; index < argv.length; index += 1) {
		const item = argv[index];
		if (item.startsWith("--")) {
			args.set(item.slice(2), argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true");
		}
	}
	return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = parseCliArgs(process.argv.slice(2));
	const server = createNativeKitCatalogServer({
		host: args.get("host") ?? "127.0.0.1",
		port: Number(args.get("port") ?? 4177),
	});
	await server.start();
}
