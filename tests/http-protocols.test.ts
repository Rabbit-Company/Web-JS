import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import http2 from "node:http2";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Web } from "../packages/core/src";

function createApp() {
	const app = new Web();

	app.use(async (ctx, next) => {
		ctx.header("x-middleware", "ran");
		return next();
	});
	app.get("/info/:id", (ctx) => ctx.json({ id: ctx.params.id, query: ctx.query().get("q"), ip: ctx.clientIp ?? null }));
	app.post("/echo", async (ctx) => ctx.json({ body: await ctx.req.text() }));

	return app;
}

interface H2Response {
	status: number;
	headers: http2.IncomingHttpHeaders;
	body: string;
}

/**
 * Sends one request with Node's HTTP/2 client (cleartext prior knowledge, or ALPN over TLS).
 */
function h2Request(origin: string, path: string, options: { method?: string; body?: string; tls?: boolean } = {}): Promise<H2Response> {
	return new Promise((resolve, reject) => {
		const client = http2.connect(origin, options.tls ? { rejectUnauthorized: false } : {});
		client.on("error", reject);

		const req = client.request({ ":method": options.method ?? "GET", ":path": path });
		let response: Omit<H2Response, "body"> = { status: 0, headers: {} };
		let body = "";

		req.on("response", (headers) => {
			response = { status: Number(headers[":status"]), headers };
		});
		req.setEncoding("utf8");
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			client.close();
			resolve({ ...response, body });
		});
		req.on("error", reject);
		req.end(options.body);
	});
}

describe("HTTP/2 (cleartext)", () => {
	test("should serve HTTP/2 prior-knowledge and HTTP/1.1 on the same port", async () => {
		const server = await createApp().listen({ port: 0, hostname: "127.0.0.1", bun: { http2: true } });

		try {
			const h2 = await h2Request(`http://127.0.0.1:${server.port}`, "/info/42?q=rabbit");
			expect(h2.status).toBe(200);
			expect(h2.headers["x-middleware"]).toBe("ran");
			expect(JSON.parse(h2.body)).toEqual({ id: "42", query: "rabbit", ip: "127.0.0.1" });

			const posted = await h2Request(`http://127.0.0.1:${server.port}`, "/echo", { method: "POST", body: "over-h2" });
			expect(JSON.parse(posted.body)).toEqual({ body: "over-h2" });

			const h1 = await fetch(`http://127.0.0.1:${server.port}/info/7`);
			expect(h1.status).toBe(200);
			expect(await h1.json()).toEqual({ id: "7", query: null, ip: "127.0.0.1" });
		} finally {
			await server.stop();
		}
	});

	test("should refuse HTTP/1.1 when http1 is false", async () => {
		const server = await createApp().listen({ port: 0, hostname: "127.0.0.1", bun: { http2: true, http1: false } });

		try {
			const h1 = await fetch(`http://127.0.0.1:${server.port}/info/1`);
			expect(h1.status).toBe(505);

			const h2 = await h2Request(`http://127.0.0.1:${server.port}`, "/info/1");
			expect(h2.status).toBe(200);
		} finally {
			await server.stop();
		}
	});
});

const openssl = Bun.which("openssl");

// TLS is required for HTTP/2 via ALPN and for HTTP/3; skip when no certificate can be generated
describe.skipIf(!openssl)("HTTP/2 and HTTP/3 (TLS)", () => {
	let dir: string;
	let tls: { key: Bun.BunFile; cert: Bun.BunFile };

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "web-js-tls-"));
		const keyPath = join(dir, "key.pem");
		const certPath = join(dir, "cert.pem");
		const result = Bun.spawnSync([
			openssl!,
			"req",
			"-x509",
			"-newkey",
			"ec",
			"-pkeyopt",
			"ec_paramgen_curve:prime256v1",
			"-nodes",
			"-keyout",
			keyPath,
			"-out",
			certPath,
			"-days",
			"1",
			"-subj",
			"/CN=localhost",
			"-addext",
			"subjectAltName=DNS:localhost,IP:127.0.0.1",
		]);
		if (result.exitCode !== 0) throw new Error(`openssl failed: ${result.stderr.toString()}`);
		tls = { key: Bun.file(keyPath), cert: Bun.file(certPath) };
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("should negotiate HTTP/2 with ALPN and keep serving HTTP/1.1", async () => {
		const server = await createApp().listen({ port: 0, hostname: "127.0.0.1", bun: { tls, http2: true } });

		try {
			const h2 = await h2Request(`https://127.0.0.1:${server.port}`, "/info/42?q=tls", { tls: true });
			expect(h2.status).toBe(200);
			expect(h2.headers["x-middleware"]).toBe("ran");
			expect(JSON.parse(h2.body)).toEqual({ id: "42", query: "tls", ip: "127.0.0.1" });

			const h1 = await fetch(`https://127.0.0.1:${server.port}/info/7`, { protocol: "http1.1", tls: { rejectUnauthorized: false } });
			expect(h1.status).toBe(200);
		} finally {
			await server.stop();
		}
	});

	test("should serve HTTP/3 and advertise it with Alt-Svc", async () => {
		const server = await createApp().listen({ port: 0, hostname: "127.0.0.1", bun: { tls, http3: true } });

		try {
			const h1 = await fetch(`https://127.0.0.1:${server.port}/info/1`, { protocol: "http1.1", tls: { rejectUnauthorized: false } });
			expect(h1.headers.get("alt-svc")).toContain(`h3=":${server.port}"`);

			const h3 = await fetch(`https://127.0.0.1:${server.port}/info/42?q=quic`, { protocol: "http3", tls: { rejectUnauthorized: false } });
			expect(h3.status).toBe(200);
			expect(h3.headers.get("x-middleware")).toBe("ran");
			expect(await h3.json()).toEqual({ id: "42", query: "quic", ip: "127.0.0.1" });

			const posted = await fetch(`https://127.0.0.1:${server.port}/echo`, {
				method: "POST",
				body: "over-h3",
				protocol: "http3",
				tls: { rejectUnauthorized: false },
			});
			expect(await posted.json()).toEqual({ body: "over-h3" });
		} finally {
			await server.stop();
		}
	});
});
