import { describe, it, expect, beforeEach } from "bun:test";
import { Web } from "../../packages/core/src";
import { basicAuth } from "../../packages/middleware/src/basic-auth";

describe("Basic Auth Middleware", () => {
	let app: Web<{ user?: any }>;

	beforeEach(() => {
		app = new Web<{ user?: any }>();
	});

	it("should reject request without auth header", async () => {
		app.use(
			basicAuth({
				validate: async (username, password) => {
					return username === "admin" && password === "secret";
				},
			}),
		);
		app.get("/", (ctx) => ctx.text("Protected"));

		const req = new Request("http://localhost/");
		const res = await app.handle(req);

		expect(res.status).toBe(401);
		expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="Restricted"');
	});

	it("should reject invalid credentials", async () => {
		app.use(
			basicAuth({
				validate: async (username, password) => {
					return username === "admin" && password === "secret";
				},
			}),
		);
		app.get("/", (ctx) => ctx.text("Protected"));

		const credentials = btoa("admin:wrong");
		const req = new Request("http://localhost/", {
			headers: { Authorization: `Basic ${credentials}` },
		});
		const res = await app.handle(req);

		expect(res.status).toBe(401);
		expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="Restricted"');
	});

	it("should accept valid credentials", async () => {
		app.use(
			basicAuth({
				validate: async (username, password) => {
					return username === "admin" && password === "secret";
				},
			}),
		);
		app.get("/", (ctx) => ctx.json({ user: ctx.get("user") }));

		const credentials = btoa("admin:secret");
		const req = new Request("http://localhost/", {
			headers: { Authorization: `Basic ${credentials}` },
		});
		const res = await app.handle(req);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.user).toEqual({ username: "admin" });
	});

	it("should use custom realm", async () => {
		app.use(
			basicAuth({
				validate: async () => false,
				realm: "Admin Area",
			}),
		);
		app.get("/", (ctx) => ctx.text("Protected"));

		const req = new Request("http://localhost/");
		const res = await app.handle(req);

		expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="Admin Area"');
	});

	it("should use custom context key", async () => {
		app.use(
			basicAuth({
				validate: async (username) => username === "admin",
				contextKey: "auth" as any,
			}),
		);
		app.get("/", (ctx) => ctx.json({ auth: ctx.get("auth" as any) }));

		const credentials = btoa("admin:pass");
		const req = new Request("http://localhost/", {
			headers: { Authorization: `Basic ${credentials}` },
		});
		const res = await app.handle(req);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.auth).toEqual({ username: "admin" });
	});

	it("should handle malformed auth header", async () => {
		app.use(
			basicAuth({
				validate: async () => true,
			}),
		);
		app.get("/", (ctx) => ctx.text("Protected"));

		const req = new Request("http://localhost/", {
			headers: { Authorization: "Basic malformed" },
		});
		const res = await app.handle(req);

		expect(res.status).toBe(400);
		expect(await res.text()).toBe("Invalid credentials");
	});

	describe("credential parsing", () => {
		// Base64 of the given bytes, like a browser or curl would send
		const basicHeader = (credentials: string, encoding: BufferEncoding = "utf8") => ({
			Authorization: `Basic ${Buffer.from(credentials, encoding).toString("base64")}`,
		});

		function recordingApp(validate: (username: string, password: string) => boolean) {
			const calls: [string, string][] = [];
			app.use(
				basicAuth({
					validate: (username, password) => {
						calls.push([username, password]);
						return validate(username, password);
					},
				}),
			);
			app.get("/", (ctx) => ctx.text("Protected"));
			return calls;
		}

		it("should keep colons in the password", async () => {
			const calls = recordingApp((u, p) => u === "alice" && p === "pa:ss:word");

			const res = await app.handle(new Request("http://localhost/", { headers: basicHeader("alice:pa:ss:word") }));

			expect(res.status).toBe(200);
			expect(calls).toEqual([["alice", "pa:ss:word"]]);
		});

		it("should reject credentials without a colon before calling validate", async () => {
			// A lookup like this would accept an unknown user if password were undefined
			const users: Record<string, string | undefined> = { admin: "secret" };
			const calls = recordingApp((u, p) => users[u] === p);

			const res = await app.handle(new Request("http://localhost/", { headers: basicHeader("nobody") }));

			expect(res.status).toBe(400);
			expect(await res.text()).toBe("Invalid credentials");
			expect(calls).toEqual([]);
		});

		it("should allow an empty password", async () => {
			const calls = recordingApp((u, p) => u === "guest" && p === "");

			const res = await app.handle(new Request("http://localhost/", { headers: basicHeader("guest:") }));

			expect(res.status).toBe(200);
			expect(calls).toEqual([["guest", ""]]);
		});

		it("should decode UTF-8 credentials", async () => {
			const calls = recordingApp((u, p) => u === "žiga" && p === "geslo-čšž");

			const res = await app.handle(new Request("http://localhost/", { headers: basicHeader("žiga:geslo-čšž") }));

			expect(res.status).toBe(200);
			expect(calls).toEqual([["žiga", "geslo-čšž"]]);
		});

		it("should fall back to Latin-1 for credentials that aren't valid UTF-8", async () => {
			const calls = recordingApp((u, p) => u === "jose" && p === "contraseña");

			const res = await app.handle(new Request("http://localhost/", { headers: basicHeader("jose:contraseña", "latin1") }));

			expect(res.status).toBe(200);
			expect(calls).toEqual([["jose", "contraseña"]]);
		});
	});

	it("should pass context to validate function", async () => {
		app.use(
			basicAuth({
				validate: async (username, password, ctx) => {
					// Check if specific header is present
					return ctx.req.headers.get("X-Special") === "yes";
				},
			}),
		);
		app.get("/", (ctx) => ctx.text("Protected"));

		const credentials = btoa("any:any");

		// Without special header
		const req1 = new Request("http://localhost/", {
			headers: { Authorization: `Basic ${credentials}` },
		});
		const res1 = await app.handle(req1);
		expect(res1.status).toBe(401);

		// With special header
		const req2 = new Request("http://localhost/", {
			headers: {
				Authorization: `Basic ${credentials}`,
				"X-Special": "yes",
			},
		});
		const res2 = await app.handle(req2);
		expect(res2.status).toBe(200);
	});

	it("should skip authentication based on skip function", async () => {
		const app = new Web();

		app.use(
			basicAuth({
				validate: () => false,
				skip: (ctx) => ctx.req.headers.get("X-Skip-Auth") === "true",
			}),
		);
		app.get("/", async (ctx) => {
			return ctx.json({ success: true });
		});

		const server = Bun.serve({
			port: 0,
			fetch: app.handleBun,
		});

		try {
			const res1 = await fetch(`http://localhost:${server.port}`);
			expect(res1.status).toBe(401);

			const res2 = await fetch(`http://localhost:${server.port}`, {
				headers: {
					"X-Skip-Auth": "true",
				},
			});
			expect(res2.status).toBe(200);
		} finally {
			server.stop();
		}
	});
});
