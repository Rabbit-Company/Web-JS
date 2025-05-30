import { describe, it, expect, beforeEach } from "bun:test";
import { Web } from "../../src";
import { cors, basicAuth, rateLimit } from "../../src/middleware";

describe("Middleware Integration", () => {
	let app: Web<{ user?: any; auth?: any }>;

	beforeEach(() => {
		app = new Web<{ user?: any; auth?: any }>();
	});

	it("should combine CORS and rate limiting", async () => {
		app.use(cors({ origin: "https://example.com" }));
		app.use(rateLimit({ max: 2 }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: {
				Origin: "https://example.com",
				"X-Forwarded-For": "192.168.1.1",
			},
		});

		// First request should have both CORS and rate limit headers
		const res1 = await app.handle(req);
		expect(res1.status).toBe(200);
		expect(res1.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
		expect(res1.headers.get("RateLimit-Limit")).toBe("2");
		expect(res1.headers.get("RateLimit-Remaining")).toBe("1");

		// Second request
		await app.handle(req);

		// Third request should be rate limited but still have CORS headers
		const res3 = await app.handle(req);
		expect(res3.status).toBe(429);
		expect(res3.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
	});

	it("should handle middleware execution order correctly", async () => {
		const order: string[] = [];

		app.use(async (ctx, next) => {
			order.push("global-before");
			const res = await next();
			order.push("global-after");
			return res;
		});

		app.use("/api/*", async (ctx, next) => {
			order.push("api-before");
			const res = await next();
			order.push("api-after");
			return res;
		});

		app.get("/api/test", async (ctx) => {
			order.push("handler");
			return ctx.text("OK");
		});

		await app.handle(new Request("http://localhost/api/test"));

		expect(order).toEqual(["global-before", "api-before", "handler", "api-after", "global-after"]);
	});

	it("should handle errors in middleware chain", async () => {
		let errorHandled = false;

		app.onError((err, ctx) => {
			errorHandled = true;
			return ctx.json({ error: err.message }, 500);
		});

		app.use(async (ctx, next) => {
			if (ctx.req.url.includes("error")) {
				throw new Error("Middleware error");
			}
			return next();
		});

		app.get("/normal", (ctx) => ctx.text("OK"));
		app.get("/error", (ctx) => ctx.text("Should not reach"));

		// Normal request
		const res1 = await app.handle(new Request("http://localhost/normal"));
		expect(res1.status).toBe(200);
		expect(errorHandled).toBe(false);

		// Error request
		const res2 = await app.handle(new Request("http://localhost/error"));
		expect(res2.status).toBe(500);
		expect(await res2.json()).toEqual({ error: "Middleware error" });
		expect(errorHandled).toBe(true);
	});

	it("should properly handle CORS preflight with auth routes", async () => {
		app.use(
			cors({
				origin: "https://app.example.com",
				credentials: true,
				allowedHeaders: ["Content-Type", "Authorization"],
			})
		);

		app.use(
			"/api",
			basicAuth({
				validate: async (username, password) => {
					return username === "admin" && password === "secret";
				},
			})
		);
		app.post("/api/data", (ctx) => ctx.json({ data: "protected" }));

		// Preflight request
		const preflightReq = new Request("http://localhost/api/data", {
			method: "OPTIONS",
			headers: {
				Origin: "https://app.example.com",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "Content-Type, Authorization",
			},
		});

		const preflightRes = await app.handle(preflightReq);
		expect(preflightRes.status).toBe(204);
		expect(preflightRes.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
		expect(preflightRes.headers.get("Access-Control-Allow-Credentials")).toBe("true");
		expect(preflightRes.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
		expect(preflightRes.headers.get("Access-Control-Allow-Methods")).toContain("POST");
	});

	it("should handle rate limiting with different key generators", async () => {
		// Rate limit by API key instead of IP
		app.use(
			rateLimit({
				max: 2,
				keyGenerator: (ctx) => {
					const apiKey = ctx.req.headers.get("X-API-Key");
					return apiKey || "anonymous";
				},
			})
		);

		app.get("/data", (ctx) => ctx.json({ data: "test" }));

		// Anonymous requests (no API key)
		const anonReq = new Request("http://localhost/data");
		expect((await app.handle(anonReq)).status).toBe(200);
		expect((await app.handle(anonReq)).status).toBe(200);
		expect((await app.handle(anonReq)).status).toBe(429);

		// Requests with API key should have separate limit
		const keyReq = new Request("http://localhost/data", {
			headers: { "X-API-Key": "user-123" },
		});
		expect((await app.handle(keyReq)).status).toBe(200);
		expect((await app.handle(keyReq)).status).toBe(200);
		expect((await app.handle(keyReq)).status).toBe(429);
	});

	it("should combine middleware on scoped routes", async () => {
		app.scope("/v1", (v1) => {
			v1.use(cors({ origin: "https://api.example.com" }));

			v1.scope("/users", (users) => {
				users.use(
					basicAuth({
						validate: async (u, p) => u === "api" && p === "key",
					})
				);

				users.get("/", (ctx) => ctx.json({ users: [] }));
				users.get("/:id", (ctx) =>
					ctx.json({
						id: ctx.params.id,
						user: ctx.get("user"),
					})
				);
			});
		});

		// Test nested route with all middleware
		const credentials = btoa("api:key");
		const req = new Request("http://localhost/v1/users/123", {
			headers: {
				Authorization: `Basic ${credentials}`,
				Origin: "https://api.example.com",
			},
		});

		const res = await app.handle(req);
		expect(res.status).toBe(200);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://api.example.com");

		const data = await res.json();
		expect(data).toEqual({
			id: "123",
			user: { username: "api" },
		});
	});
});
