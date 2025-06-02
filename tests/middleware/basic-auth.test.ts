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
			})
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
			})
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
			})
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
			})
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
			})
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
			})
		);
		app.get("/", (ctx) => ctx.text("Protected"));

		const req = new Request("http://localhost/", {
			headers: { Authorization: "Basic malformed" },
		});
		const res = await app.handle(req);

		expect(res.status).toBe(400);
		expect(await res.text()).toBe("Invalid credentials");
	});

	it("should pass context to validate function", async () => {
		app.use(
			basicAuth({
				validate: async (username, password, ctx) => {
					// Check if specific header is present
					return ctx.req.headers.get("X-Special") === "yes";
				},
			})
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
});
