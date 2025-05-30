import { describe, expect, it } from "bun:test";
import { bearerAuth } from "../../../src/middleware";
import { Web } from "../../../src";

function mockRequest(path: string, method = "GET", headers: Record<string, string> = {}) {
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			Host: "localhost",
			...headers,
		},
	});
}

describe("Bearer Authentication Middleware", () => {
	describe("Basic Token Validation", () => {
		it("should reject requests without Authorization header", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
				})
			);

			app.get("/protected", (c) => c.text("Protected resource"));

			const res = await app.handle(mockRequest("/protected"));

			expect(res.status).toBe(401);
			expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
			expect(await res.json()).toEqual({
				error: "Authorization token required",
			});
		});

		it("should reject requests with malformed Authorization header", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
				})
			);

			app.get("/protected", (c) => c.text("Protected resource"));

			const res = await app.handle(
				mockRequest("/protected", "GET", {
					Authorization: "Basic dXNlcjpwYXNz", // Wrong scheme
				})
			);

			expect(res.status).toBe(401);
			expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
			expect(await res.json()).toEqual({
				error: "Authorization token required",
			});
		});

		it("should reject requests with empty Bearer token", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
				})
			);

			app.get("/protected", (c) => c.text("Protected resource"));

			const res = await app.handle(
				mockRequest("/protected", "GET", {
					Authorization: "Bearer   ", // Empty/whitespace token
				})
			);

			expect(res.status).toBe(401);
			expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
			expect(await res.json()).toEqual({
				error: "Authorization token required",
			});
		});

		it("should reject requests with invalid token", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
				})
			);

			app.get("/protected", (c) => c.text("Protected resource"));

			const res = await app.handle(
				mockRequest("/protected", "GET", {
					Authorization: "Bearer invalid-token",
				})
			);

			expect(res.status).toBe(401);
			expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
			expect(await res.json()).toEqual({
				error: "Invalid or expired token",
			});
		});

		it("should accept requests with valid token", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
				})
			);

			app.get("/protected", (c) => c.text("Protected resource"));

			const res = await app.handle(
				mockRequest("/protected", "GET", {
					Authorization: "Bearer valid-token",
				})
			);

			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Protected resource");
		});
	});

	describe("User Data Handling", () => {
		it("should set empty user object when validation returns true", async () => {
			const app = new Web<{ user: Record<string, unknown> }>();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
				})
			);

			app.get("/user", (c) => c.json(c.get("user")));

			const res = await app.handle(
				mockRequest("/user", "GET", {
					Authorization: "Bearer valid-token",
				})
			);

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({});
		});

		it("should set user data when validation returns user object", async () => {
			const app = new Web<{ user: { id: string; email: string; role: string } }>();

			app.use(
				bearerAuth({
					validate: (token) => {
						if (token === "user-token") {
							return { id: "123", email: "user@example.com", role: "user" };
						}
						return false;
					},
				})
			);

			app.get("/profile", (c) => c.json(c.get("user")));

			const res = await app.handle(
				mockRequest("/profile", "GET", {
					Authorization: "Bearer user-token",
				})
			);

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				id: "123",
				email: "user@example.com",
				role: "user",
			});
		});

		it("should use custom context key", async () => {
			const app = new Web<{ currentUser: { id: string } }>();

			app.use(
				bearerAuth({
					validate: (token) => (token === "valid-token" ? { id: "123" } : false),
					contextKey: "currentUser",
				})
			);

			app.get("/me", (c) => c.json(c.get("currentUser")));

			const res = await app.handle(
				mockRequest("/me", "GET", {
					Authorization: "Bearer valid-token",
				})
			);

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ id: "123" });
		});
	});

	describe("Async Validation", () => {
		it("should handle async token validation", async () => {
			const app = new Web<{ user: { id: string; permissions: string[] } }>();

			// Simulate database lookup
			const mockDatabase = {
				"api-key-123": { id: "user-456", permissions: ["read", "write"] },
				"api-key-456": { id: "user-789", permissions: ["read"] },
			};

			app.use(
				bearerAuth({
					validate: async (token) => {
						// Simulate async database call
						await new Promise((resolve) => setTimeout(resolve, 10));
						return mockDatabase[token as keyof typeof mockDatabase] || false;
					},
				})
			);

			app.get("/data", (c) => c.json(c.get("user")));

			// Valid token
			const validRes = await app.handle(
				mockRequest("/data", "GET", {
					Authorization: "Bearer api-key-123",
				})
			);

			expect(validRes.status).toBe(200);
			expect(await validRes.json()).toEqual({
				id: "user-456",
				permissions: ["read", "write"],
			});

			// Invalid token
			const invalidRes = await app.handle(
				mockRequest("/data", "GET", {
					Authorization: "Bearer invalid-key",
				})
			);

			expect(invalidRes.status).toBe(401);
		});

		it("should handle validation errors gracefully", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: async (token) => {
						if (token === "error-token") {
							throw new Error("Database connection failed");
						}
						return token === "valid-token";
					},
				})
			);

			app.get("/protected", (c) => c.text("Protected"));

			const res = await app.handle(
				mockRequest("/protected", "GET", {
					Authorization: "Bearer error-token",
				})
			);

			expect(res.status).toBe(500);
			expect(await res.json()).toEqual({
				error: "Invalid or expired token",
			});
		});
	});

	describe("JWT Simulation", () => {
		it("should work with JWT-like tokens", async () => {
			const app = new Web<{ user: { sub: string; email: string; exp: number } }>();

			// Mock JWT validation
			const mockJWT = {
				verify: (token: string) => {
					if (token === "valid.jwt.token") {
						return {
							sub: "user-123",
							email: "user@example.com",
							exp: Math.floor(Date.now() / 1000) + 3600,
						};
					}
					throw new Error("Invalid token");
				},
			};

			app.use(
				bearerAuth({
					validate: async (token) => {
						try {
							const payload = mockJWT.verify(token);

							// Check expiration
							if (payload.exp < Math.floor(Date.now() / 1000)) {
								return false;
							}

							return payload;
						} catch {
							return false;
						}
					},
				})
			);

			app.get("/profile", (c) => c.json(c.get("user")));

			const res = await app.handle(
				mockRequest("/profile", "GET", {
					Authorization: "Bearer valid.jwt.token",
				})
			);

			expect(res.status).toBe(200);
			const user = await res.json();
			expect(user.sub).toBe("user-123");
			expect(user.email).toBe("user@example.com");
		});
	});

	describe("Configuration Options", () => {
		it("should use custom scheme", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
					scheme: "Token",
				})
			);

			app.get("/protected", (c) => c.text("Protected"));

			const res = await app.handle(mockRequest("/protected"));

			expect(res.status).toBe(401);
			expect(res.headers.get("WWW-Authenticate")).toBe("Token");
		});

		it("should include realm in WWW-Authenticate header", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
					realm: "API",
				})
			);

			app.get("/protected", (c) => c.text("Protected"));

			const res = await app.handle(mockRequest("/protected"));

			expect(res.status).toBe(401);
			expect(res.headers.get("WWW-Authenticate")).toBe('Bearer realm="API"');
		});

		it("should use custom error messages", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
					missingTokenMessage: "API key required",
					invalidTokenMessage: "API key is invalid or expired",
				})
			);

			app.get("/protected", (c) => c.text("Protected"));

			// Missing token
			const missingRes = await app.handle(mockRequest("/protected"));
			expect(await missingRes.json()).toEqual({
				error: "API key required",
			});

			// Invalid token
			const invalidRes = await app.handle(
				mockRequest("/protected", "GET", {
					Authorization: "Bearer wrong-token",
				})
			);
			expect(await invalidRes.json()).toEqual({
				error: "API key is invalid or expired",
			});
		});
	});

	describe("Context Access", () => {
		it("should provide context to validation function", async () => {
			const app = new Web<{ user: { id: string; ip: string } }>();

			app.use(
				bearerAuth({
					validate: async (token, ctx) => {
						if (token === "valid-token") {
							// Access request context during validation
							const userAgent = ctx.req.headers.get("User-Agent");
							const host = ctx.req.headers.get("Host");

							return {
								id: "123",
								ip: host || "unknown",
								userAgent: userAgent || "unknown",
							};
						}
						return false;
					},
				})
			);

			app.get("/info", (c) => c.json(c.get("user")));

			const res = await app.handle(
				mockRequest("/info", "GET", {
					Authorization: "Bearer valid-token",
					"User-Agent": "TestAgent/1.0",
				})
			);

			expect(res.status).toBe(200);
			const user = await res.json();
			expect(user.id).toBe("123");
			expect(user.ip).toBe("localhost");
			expect(user.userAgent).toBe("TestAgent/1.0");
		});
	});

	describe("Route-Specific Authentication", () => {
		it("should protect only specific routes", async () => {
			const app = new Web<{ user: { role: string } }>();

			// Public route
			app.get("/public", (c) => c.text("Public content"));

			// Protected routes
			app.use(
				"/admin/*",
				bearerAuth({
					validate: (token) => {
						if (token === "admin-token") {
							return { role: "admin" };
						}
						return false;
					},
				})
			);

			app.get("/admin/dashboard", (c) => {
				const user = c.get("user");
				return c.json({ dashboard: "admin", role: user.role });
			});

			// Public route should work without auth
			const publicRes = await app.handle(mockRequest("/public"));
			expect(publicRes.status).toBe(200);
			expect(await publicRes.text()).toBe("Public content");

			// Protected route should require auth
			const protectedRes = await app.handle(mockRequest("/admin/dashboard"));
			expect(protectedRes.status).toBe(401);

			// Protected route should work with valid token
			const authRes = await app.handle(
				mockRequest("/admin/dashboard", "GET", {
					Authorization: "Bearer admin-token",
				})
			);
			expect(authRes.status).toBe(200);
			expect(await authRes.json()).toEqual({
				dashboard: "admin",
				role: "admin",
			});
		});
	});

	describe("Multiple Authentication Strategies", () => {
		it("should work with different tokens for different routes", async () => {
			const app = new Web<{ user: { type: string; id: string } }>();

			// API routes with API key auth
			app.use(
				"/api/*",
				bearerAuth({
					validate: (token) => {
						if (token.startsWith("api-")) {
							return { type: "api", id: token };
						}
						return false;
					},
					contextKey: "user",
				})
			);

			// Admin routes with admin token auth
			app.use(
				"/admin/*",
				bearerAuth({
					validate: (token) => {
						if (token === "admin-secret") {
							return { type: "admin", id: "admin-user" };
						}
						return false;
					},
					contextKey: "user",
				})
			);

			app.get("/api/data", (c) => c.json(c.get("user")));
			app.get("/admin/settings", (c) => c.json(c.get("user")));

			// API route with API token
			const apiRes = await app.handle(
				mockRequest("/api/data", "GET", {
					Authorization: "Bearer api-key-123",
				})
			);
			expect(await apiRes.json()).toEqual({
				type: "api",
				id: "api-key-123",
			});

			// Admin route with admin token
			const adminRes = await app.handle(
				mockRequest("/admin/settings", "GET", {
					Authorization: "Bearer admin-secret",
				})
			);
			expect(await adminRes.json()).toEqual({
				type: "admin",
				id: "admin-user",
			});

			// API route with admin token should fail
			const wrongTokenRes = await app.handle(
				mockRequest("/api/data", "GET", {
					Authorization: "Bearer admin-secret",
				})
			);
			expect(wrongTokenRes.status).toBe(401);
		});
	});

	describe("Integration with Route Mounting", () => {
		it("should work when mounting sub-applications", async () => {
			const app = new Web<{ user: { id: string; scope: string } }>();
			const protectedApi = new Web<{ user: { id: string; scope: string } }>();

			// Add auth to sub-application
			protectedApi.use(
				bearerAuth({
					validate: (token) => {
						if (token === "api-token") {
							return { id: "user-123", scope: "api" };
						}
						return false;
					},
				})
			);

			protectedApi.get("/profile", (c) => {
				return c.json({
					message: "Protected profile",
					user: c.get("user"),
				});
			});

			// Mount the protected API
			app.route("/api/v1", protectedApi);

			// Should require authentication
			const unauthorizedRes = await app.handle(mockRequest("/api/v1/profile"));
			expect(unauthorizedRes.status).toBe(401);

			// Should work with valid token
			const authorizedRes = await app.handle(
				mockRequest("/api/v1/profile", "GET", {
					Authorization: "Bearer api-token",
				})
			);
			expect(authorizedRes.status).toBe(200);
			expect(await authorizedRes.json()).toEqual({
				message: "Protected profile",
				user: { id: "user-123", scope: "api" },
			});
		});
	});

	describe("Edge Cases", () => {
		it("should handle tokens with special characters", async () => {
			const app = new Web();

			const specialToken = "abc.123-456_789+ABC/def=";

			app.use(
				bearerAuth({
					validate: (token) => token === specialToken,
				})
			);

			app.get("/test", (c) => c.text("Success"));

			const res = await app.handle(
				mockRequest("/test", "GET", {
					Authorization: `Bearer ${specialToken}`,
				})
			);

			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Success");
		});

		it("should handle very long tokens", async () => {
			const app = new Web();

			const longToken = "a".repeat(2000); // Very long token

			app.use(
				bearerAuth({
					validate: (token) => token === longToken,
				})
			);

			app.get("/test", (c) => c.text("Success"));

			const res = await app.handle(
				mockRequest("/test", "GET", {
					Authorization: `Bearer ${longToken}`,
				})
			);

			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Success");
		});

		it("should handle case-sensitive scheme", async () => {
			const app = new Web();

			app.use(
				bearerAuth({
					validate: (token) => token === "valid-token",
				})
			);

			app.get("/test", (c) => c.text("Success"));

			// Should reject lowercase "bearer"
			const res = await app.handle(
				mockRequest("/test", "GET", {
					Authorization: "bearer valid-token",
				})
			);

			expect(res.status).toBe(401);
		});
	});
});
