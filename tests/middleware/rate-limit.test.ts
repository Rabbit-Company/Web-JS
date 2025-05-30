import { describe, it, expect, beforeEach } from "bun:test";
import { Web } from "../../packages/core";
import { rateLimit, createRateLimiter, createKeyGenerator, Algorithm } from "../../packages/middleware/src/security/rate-limit";

describe("Rate Limit Middleware", () => {
	let app: Web;

	beforeEach(() => {
		app = new Web();
	});

	it("should allow requests under the limit", async () => {
		app.use(rateLimit({ max: 3, windowMs: 1000 }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});

		// First 3 requests should succeed
		for (let i = 0; i < 3; i++) {
			const res = await app.handle(req);
			expect(res.status).toBe(200);
			expect(res.headers.get("RateLimit-Limit")).toBe("3");
			expect(res.headers.get("RateLimit-Remaining")).toBe(String(3 - i - 1));
		}
	});

	it("should block requests over the limit", async () => {
		app.use(rateLimit({ max: 2, windowMs: 1000 }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});

		// First 2 requests succeed
		await app.handle(req);
		await app.handle(req);

		// Third request should be blocked
		const res = await app.handle(req);
		expect(res.status).toBe(429);
		expect(res.headers.get("RateLimit-Remaining")).toBe("0");
		expect(res.headers.get("Retry-After")).toBeDefined();

		const body = await res.json();
		expect(body.error).toBe("Too many requests");
		expect(body.retryAfter).toBeDefined();
		expect(body.limit).toBe(2);
		expect(body.window).toBe(1000);
		expect(body.reset).toBeDefined();
	});

	it("should use custom error message and status", async () => {
		app.use(
			rateLimit({
				max: 1,
				message: "Rate limit exceeded",
				statusCode: 503,
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/");

		await app.handle(req);
		const res = await app.handle(req);

		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe("Rate limit exceeded");
	});

	it("should reset after window expires", async () => {
		app.use(rateLimit({ max: 1, windowMs: 100 })); // 100ms window
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});

		// First request succeeds
		const res1 = await app.handle(req);
		expect(res1.status).toBe(200);

		// Second request blocked
		const res2 = await app.handle(req);
		expect(res2.status).toBe(429);

		// Wait for window to expire
		await new Promise((resolve) => setTimeout(resolve, 150));

		// Should succeed again
		const res3 = await app.handle(req);
		expect(res3.status).toBe(200);
	});

	it("should track different IPs separately", async () => {
		app.use(rateLimit({ max: 1 }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req1 = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});
		const req2 = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "192.168.1.2" },
		});

		// Both IPs should get one request
		const res1 = await app.handle(req1);
		const res2 = await app.handle(req2);

		expect(res1.status).toBe(200);
		expect(res2.status).toBe(200);

		// Second request from first IP should be blocked
		const res3 = await app.handle(req1);
		expect(res3.status).toBe(429);

		// Second IP can still make requests (but will be blocked on second request)
		const res4 = await app.handle(req2);
		expect(res4.status).toBe(429);
	});

	it("should use custom key generator", async () => {
		app.use(
			rateLimit({
				max: 1,
				keyGenerator: (ctx) => ctx.req.headers.get("API-Key") || "anonymous",
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req1 = new Request("http://localhost/", {
			headers: { "API-Key": "user-123" },
		});
		const req2 = new Request("http://localhost/", {
			headers: { "API-Key": "user-456" },
		});

		// Different API keys tracked separately
		expect((await app.handle(req1)).status).toBe(200);
		expect((await app.handle(req2)).status).toBe(200);

		// Same key blocked
		expect((await app.handle(req1)).status).toBe(429);
	});

	it("should skip rate limiting when skip returns true", async () => {
		app.use(
			rateLimit({
				max: 1,
				skip: (ctx) => ctx.req.headers.get("X-Admin") === "true",
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const adminReq = new Request("http://localhost/", {
			headers: { "X-Admin": "true" },
		});
		const normalReq = new Request("http://localhost/");

		// Admin requests not limited
		for (let i = 0; i < 5; i++) {
			const res = await app.handle(adminReq);
			expect(res.status).toBe(200);
		}

		// Normal request limited
		expect((await app.handle(normalReq)).status).toBe(200);
		expect((await app.handle(normalReq)).status).toBe(429);
	});

	it("should handle async skip function", async () => {
		app.use(
			rateLimit({
				max: 1,
				skip: async (ctx) => {
					// Simulate async check
					await new Promise((resolve) => setTimeout(resolve, 10));
					return ctx.req.url.includes("webhook");
				},
			})
		);
		app.get("/webhook", (ctx) => ctx.text("OK"));
		app.get("/api", (ctx) => ctx.text("OK"));

		// Webhook not limited
		for (let i = 0; i < 3; i++) {
			const res = await app.handle(new Request("http://localhost/webhook"));
			expect(res.status).toBe(200);
		}

		// API limited
		expect((await app.handle(new Request("http://localhost/api"))).status).toBe(200);
		expect((await app.handle(new Request("http://localhost/api"))).status).toBe(429);
	});

	it("should not include headers when headers option is false", async () => {
		app.use(rateLimit({ max: 1, headers: false }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/");
		const res = await app.handle(req);

		expect(res.headers.get("RateLimit-Limit")).toBeNull();
		expect(res.headers.get("RateLimit-Remaining")).toBeNull();
		expect(res.headers.get("RateLimit-Reset")).toBeNull();
	});

	it("should handle X-Real-IP header fallback", async () => {
		app.use(rateLimit({ max: 1 }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "X-Real-IP": "10.0.0.1" },
		});

		expect((await app.handle(req)).status).toBe(200);
		expect((await app.handle(req)).status).toBe(429);
	});

	it("should handle CF-Connecting-IP header", async () => {
		app.use(rateLimit({ max: 1 }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "CF-Connecting-IP": "172.16.0.1" },
		});

		expect((await app.handle(req)).status).toBe(200);
		expect((await app.handle(req)).status).toBe(429);
	});

	it("should use custom endpoint generator", async () => {
		app.use(
			rateLimit({
				max: 2,
				endpointGenerator: (ctx) => "global", // All requests share the same limit
			})
		);
		app.get("/api/users", (ctx) => ctx.text("Users"));
		app.get("/api/posts", (ctx) => ctx.text("Posts"));

		const req1 = new Request("http://localhost/api/users", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});
		const req2 = new Request("http://localhost/api/posts", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});

		// Both requests count towards global limit
		expect((await app.handle(req1)).status).toBe(200);
		expect((await app.handle(req2)).status).toBe(200);
		expect((await app.handle(req1)).status).toBe(429); // Third request blocked
	});

	it("should work with sliding window algorithm", async () => {
		app.use(
			rateLimit({
				algorithm: Algorithm.SLIDING_WINDOW,
				max: 3,
				windowMs: 200,
				precision: 50,
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});

		// Make 3 requests
		for (let i = 0; i < 3; i++) {
			expect((await app.handle(req)).status).toBe(200);
		}

		// Fourth request should be blocked
		expect((await app.handle(req)).status).toBe(429);

		// Wait for half the window
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Still blocked because sliding window
		expect((await app.handle(req)).status).toBe(429);

		// Wait for full window to pass
		await new Promise((resolve) => setTimeout(resolve, 150));

		// Should work again
		expect((await app.handle(req)).status).toBe(200);
	});

	it("should work with token bucket algorithm", async () => {
		app.use(
			rateLimit({
				algorithm: Algorithm.TOKEN_BUCKET,
				max: 3, // Bucket capacity
				refillRate: 1, // 1 token per interval
				refillInterval: 100, // Refill every 100ms
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});

		// Use all tokens
		for (let i = 0; i < 3; i++) {
			expect((await app.handle(req)).status).toBe(200);
		}

		// No tokens left
		expect((await app.handle(req)).status).toBe(429);

		// Wait for one token to refill
		await new Promise((resolve) => setTimeout(resolve, 120));

		// Should have 1 token available
		expect((await app.handle(req)).status).toBe(200);
		expect((await app.handle(req)).status).toBe(429);
	});

	it("should use shared rate limiter instance", async () => {
		const sharedLimiter = createRateLimiter({
			max: 2,
			window: 1000,
		});

		// Two different endpoints sharing the same limiter
		app.use("/api/users", rateLimit({ rateLimiter: sharedLimiter, endpointGenerator: () => "/api/*" }));
		app.use("/api/posts", rateLimit({ rateLimiter: sharedLimiter, endpointGenerator: () => "/api/*" }));

		app.get("/api/users", (ctx) => ctx.text("Users"));
		app.get("/api/posts", (ctx) => ctx.text("Posts"));

		const userReq = new Request("http://localhost/api/users", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});
		const postReq = new Request("http://localhost/api/posts", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});

		// Both endpoints share the same rate limit
		expect((await app.handle(userReq)).status).toBe(200);
		expect((await app.handle(postReq)).status).toBe(200);
		expect((await app.handle(userReq)).status).toBe(429); // Shared limit exceeded
	});

	it("should use createKeyGenerator utility", async () => {
		app.use(
			rateLimit({
				max: 1,
				keyGenerator: createKeyGenerator({
					useIp: true,
					custom: (ctx) => ctx.req.headers.get("API-Key"),
				}),
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req1 = new Request("http://localhost/", {
			headers: {
				"X-Forwarded-For": "192.168.1.1",
				"API-Key": "key-123",
			},
		});

		const req2 = new Request("http://localhost/", {
			headers: {
				"X-Forwarded-For": "192.168.1.1",
				"API-Key": "key-456",
			},
		});

		// Different composite keys (IP + API Key)
		expect((await app.handle(req1)).status).toBe(200);
		expect((await app.handle(req2)).status).toBe(200);

		// Same composite key blocked
		expect((await app.handle(req1)).status).toBe(429);
	});

	it("should include algorithm in headers", async () => {
		app.use(
			rateLimit({
				algorithm: Algorithm.TOKEN_BUCKET,
				max: 1,
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/");
		const res = await app.handle(req);

		expect(res.headers.get("RateLimit-Algorithm")).toBe(Algorithm.TOKEN_BUCKET);
	});

	it("should handle multiple X-Forwarded-For IPs", async () => {
		app.use(rateLimit({ max: 1 }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "203.0.113.195, 70.41.3.18, 150.172.238.178" },
		});

		// Should use first IP
		expect((await app.handle(req)).status).toBe(200);
		expect((await app.handle(req)).status).toBe(429);
	});

	it("should disable automatic cleanup", async () => {
		const limiter = createRateLimiter({
			max: 1,
			window: 100,
			enableCleanup: false,
		});

		app.use(rateLimit({ rateLimiter: limiter }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { "X-Forwarded-For": "192.168.1.1" },
		});

		expect((await app.handle(req)).status).toBe(200);
		expect((await app.handle(req)).status).toBe(429);

		// Check that entries exist
		expect(limiter.getSize()).toBeGreaterThan(0);

		// Wait for window to expire
		await new Promise((resolve) => setTimeout(resolve, 150));

		// Entries should still exist (no automatic cleanup)
		expect(limiter.getSize()).toBeGreaterThan(0);

		// Manual cleanup
		limiter.clear();
		expect(limiter.getSize()).toBe(0);
	});
});
