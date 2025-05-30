import { describe, expect, it } from "bun:test";
import { Web } from "../packages/core/src";

function mockRequest(path: string, method = "GET", headers: Record<string, string> = {}) {
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			Host: "localhost",
			...headers,
		},
	});
}

describe("Web Framework", () => {
	describe("Basic Routing", () => {
		it("should handle GET requests", async () => {
			const app = new Web();
			app.get("/hello", (c) => c.text("Hello World"));

			const res = await app.handle(mockRequest("/hello"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Hello World");
		});

		it("should handle POST requests", async () => {
			const app = new Web();
			app.post("/users", (c) => c.text("User created", 201));

			const res = await app.handle(mockRequest("/users", "POST"));
			expect(res.status).toBe(201);
			expect(await res.text()).toBe("User created");
		});

		it("should handle PUT requests", async () => {
			const app = new Web();
			app.put("/users/:id", (c) => c.text(`Updated ${c.params.id}`));

			const res = await app.handle(mockRequest("/users/123", "PUT"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Updated 123");
		});

		it("should handle DELETE requests", async () => {
			const app = new Web();
			app.delete("/users/:id", (c) => c.text(`Deleted ${c.params.id}`));

			const res = await app.handle(mockRequest("/users/123", "DELETE"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Deleted 123");
		});

		it("should handle PATCH requests", async () => {
			const app = new Web();
			app.patch("/users/:id", (c) => c.text(`Patched ${c.params.id}`));

			const res = await app.handle(mockRequest("/users/123", "PATCH"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Patched 123");
		});

		it("should handle HEAD requests", async () => {
			const app = new Web();
			app.head("/health", (c) => c.text("OK"));

			const res = await app.handle(mockRequest("/health", "HEAD"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("");
		});

		it("should handle OPTIONS requests", async () => {
			const app = new Web();
			app.options("/users", (c) => {
				return c.text("", 200, {
					Allow: "GET, POST",
				});
			});

			const res = await app.handle(mockRequest("/users", "OPTIONS"));
			expect(res.status).toBe(200);
			expect(res.headers.get("Allow")).toBe("GET, POST");
		});
	});

	describe("Route Parameters", () => {
		it("should parse route parameters", async () => {
			const app = new Web();
			app.get("/users/:id", (c) => c.text(`User ${c.params.id}`));

			const res = await app.handle(mockRequest("/users/42"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("User 42");
		});

		it("should handle multiple parameters", async () => {
			const app = new Web();
			app.get("/posts/:category/:id", (c) =>
				c.json({
					category: c.params.category,
					id: c.params.id,
				})
			);

			const res = await app.handle(mockRequest("/posts/tech/123"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				category: "tech",
				id: "123",
			});
		});

		it("should handle wildcard routes", async () => {
			const app = new Web();
			app.get("/assets/*", (c) => c.text(`Path: ${c.params["*"]}`));

			const res = await app.handle(mockRequest("/assets/images/logo.png"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Path: images/logo.png");
		});
	});

	describe("Middleware", () => {
		it("should execute middleware in order", async () => {
			const app = new Web();
			const calls: string[] = [];

			app.use(async (c, next) => {
				calls.push("first");
				await next();
			});

			app.use(async (c, next) => {
				calls.push("second");
				await next();
			});

			app.get("/test", (c) => {
				calls.push("handler");
				return c.text("OK");
			});

			await app.handle(mockRequest("/test"));
			expect(calls).toEqual(["first", "second", "handler"]);
		});

		it("should allow middleware to modify context", async () => {
			const app = new Web<{ "x-request-id": string }>();

			app.use(async (c, next) => {
				c.set("x-request-id", "123");
				await next();
			});

			app.get("/id", (c) => c.text(c.get("x-request-id")));

			const res = await app.handle(mockRequest("/id"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("123");
		});

		it("should support scoped middleware", async () => {
			const app = new Web<{ role: string }>();

			app.use("/admin/*", async (c, next) => {
				c.set("role", "admin");
				await next();
			});

			app.get("/admin/dashboard", (c) => c.text(c.get("role")));
			app.get("/public", (c) => c.text(c.get("role") || "public"));

			const adminRes = await app.handle(mockRequest("/admin/dashboard"));
			expect(await adminRes.text()).toBe("admin");

			const publicRes = await app.handle(mockRequest("/public"));
			expect(await publicRes.text()).toBe("public");
		});
	});

	describe("Middleware Route Mounting", () => {
		it("should copy middleware when mounting sub-applications with route()", async () => {
			const app = new Web<{ role: string; authToken?: string }>();
			const protectedApi = new Web<{ role: string; authToken?: string }>();

			// Add authentication middleware to the sub-application
			protectedApi.use(async (ctx, next) => {
				const authHeader = ctx.req.headers.get("Authorization");

				if (!authHeader || !authHeader.startsWith("Bearer ")) {
					return ctx.json({ error: "Missing or invalid authorization" }, 401);
				}

				const token = authHeader.substring(7);

				if (token === "valid-token") {
					ctx.set("role", "authenticated");
					ctx.set("authToken", token);
				} else {
					return ctx.json({ error: "Invalid token" }, 401);
				}

				await next();
			});

			// Add a protected route
			protectedApi.get("/profile", (ctx) => {
				return ctx.json({
					role: ctx.get("role"),
					token: ctx.get("authToken"),
					message: "Protected data",
				});
			});

			// Mount the protected API
			app.route("/api/protected", protectedApi);

			// Test without auth header - should be blocked by middleware
			const unauthorizedRes = await app.handle(mockRequest("/api/protected/profile", "GET"));
			expect(unauthorizedRes.status).toBe(401);
			expect(await unauthorizedRes.json()).toEqual({
				error: "Missing or invalid authorization",
			});

			// Test with invalid token - should be blocked by middleware
			const invalidTokenRes = await app.handle(
				mockRequest("/api/protected/profile", "GET", {
					Authorization: "Bearer invalid-token",
				})
			);
			expect(invalidTokenRes.status).toBe(401);
			expect(await invalidTokenRes.json()).toEqual({
				error: "Invalid token",
			});

			// Test with valid token - should pass through middleware and reach handler
			const validRes = await app.handle(
				mockRequest("/api/protected/profile", "GET", {
					Authorization: "Bearer valid-token",
				})
			);
			expect(validRes.status).toBe(200);
			expect(await validRes.json()).toEqual({
				role: "authenticated",
				token: "valid-token",
				message: "Protected data",
			});
		});

		it("should copy method-specific middleware when mounting sub-applications", async () => {
			const app = new Web<{ method: string }>();
			const api = new Web<{ method: string }>();

			// Add method-specific middleware to the sub-application
			api.use("POST", "/users", async (ctx, next) => {
				ctx.set("method", "POST middleware executed");
				await next();
			});

			api.use("GET", "/users", async (ctx, next) => {
				ctx.set("method", "GET middleware executed");
				await next();
			});

			// Add routes
			api.get("/users", (ctx) => {
				return ctx.text(ctx.get("method") || "no middleware");
			});

			api.post("/users", (ctx) => {
				return ctx.text(ctx.get("method") || "no middleware");
			});

			// Mount the API
			app.route("/api", api);

			// Test GET request - should execute GET middleware
			const getRes = await app.handle(mockRequest("/api/users", "GET"));
			expect(await getRes.text()).toBe("GET middleware executed");

			// Test POST request - should execute POST middleware
			const postRes = await app.handle(mockRequest("/api/users", "POST"));
			expect(await postRes.text()).toBe("POST middleware executed");
		});

		it("should copy path-specific middleware when mounting sub-applications", async () => {
			const app = new Web<{ pathMiddleware: string }>();
			const admin = new Web<{ pathMiddleware: string }>();

			// Add path-specific middleware to the sub-application
			admin.use("/dashboard/*", async (ctx, next) => {
				ctx.set("pathMiddleware", "dashboard middleware");
				await next();
			});

			admin.use("/settings", async (ctx, next) => {
				ctx.set("pathMiddleware", "settings middleware");
				await next();
			});

			// Add routes
			admin.get("/dashboard/overview", (ctx) => {
				return ctx.text(ctx.get("pathMiddleware") || "no middleware");
			});

			admin.get("/dashboard/stats", (ctx) => {
				return ctx.text(ctx.get("pathMiddleware") || "no middleware");
			});

			admin.get("/settings", (ctx) => {
				return ctx.text(ctx.get("pathMiddleware") || "no middleware");
			});

			admin.get("/other", (ctx) => {
				return ctx.text(ctx.get("pathMiddleware") || "no middleware");
			});

			// Mount the admin panel
			app.route("/admin", admin);

			// Test dashboard routes - should execute dashboard middleware
			const dashboardOverviewRes = await app.handle(mockRequest("/admin/dashboard/overview"));
			expect(await dashboardOverviewRes.text()).toBe("dashboard middleware");

			const dashboardStatsRes = await app.handle(mockRequest("/admin/dashboard/stats"));
			expect(await dashboardStatsRes.text()).toBe("dashboard middleware");

			// Test settings route - should execute settings middleware
			const settingsRes = await app.handle(mockRequest("/admin/settings"));
			expect(await settingsRes.text()).toBe("settings middleware");

			// Test other route - should not execute any path-specific middleware
			const otherRes = await app.handle(mockRequest("/admin/other"));
			expect(await otherRes.text()).toBe("no middleware");
		});

		it("should copy global middleware when mounting sub-applications", async () => {
			const app = new Web<{ global: string; subGlobal: string }>();
			const api = new Web<{ global: string; subGlobal: string }>();

			// Add global middleware to main app
			app.use(async (ctx, next) => {
				ctx.set("global", "main app global");
				await next();
			});

			// Add global middleware to sub-application
			api.use(async (ctx, next) => {
				ctx.set("subGlobal", "sub app global");
				await next();
			});

			// Add route to sub-application
			api.get("/test", (ctx) => {
				return ctx.json({
					global: ctx.get("global"),
					subGlobal: ctx.get("subGlobal"),
				});
			});

			// Mount the API
			app.route("/api", api);

			const res = await app.handle(mockRequest("/api/test"));
			expect(await res.json()).toEqual({
				global: "main app global",
				subGlobal: "sub app global",
			});
		});

		it("should handle nested route mounting with middleware", async () => {
			const app = new Web<{ level: string }>();
			const api = new Web<{ level: string }>();
			const v1 = new Web<{ level: string }>();

			// Add middleware at each level
			app.use(async (ctx, next) => {
				ctx.set("level", "app");
				await next();
			});

			api.use(async (ctx, next) => {
				const current = ctx.get("level");
				ctx.set("level", `${current} -> api`);
				await next();
			});

			v1.use(async (ctx, next) => {
				const current = ctx.get("level");
				ctx.set("level", `${current} -> v1`);
				await next();
			});

			// Add route to deepest level
			v1.get("/users", (ctx) => {
				const level = ctx.get("level");
				return ctx.text(`${level} -> handler`);
			});

			// Mount nested applications
			api.route("/v1", v1);
			app.route("/api", api);

			const res = await app.handle(mockRequest("/api/v1/users"));
			expect(await res.text()).toBe("app -> api -> v1 -> handler");
		});

		it("should maintain middleware execution order after mounting", async () => {
			const app = new Web<{ calls: string[] }>();
			const subApp = new Web<{ calls: string[] }>();

			// Add middleware to main app
			app.use(async (ctx, next) => {
				const calls = ctx.get("calls") || [];
				calls.push("main-1");
				ctx.set("calls", calls);
				await next();
			});

			app.use("/mounted/*", async (ctx, next) => {
				const calls = ctx.get("calls") || [];
				calls.push("main-scoped");
				ctx.set("calls", calls);
				await next();
			});

			// Add middleware to sub-app
			subApp.use(async (ctx, next) => {
				const calls = ctx.get("calls") || [];
				calls.push("sub-global");
				ctx.set("calls", calls);
				await next();
			});

			subApp.use("/test", async (ctx, next) => {
				const calls = ctx.get("calls") || [];
				calls.push("sub-scoped");
				ctx.set("calls", calls);
				await next();
			});

			// Add route to sub-app
			subApp.get("/test", (ctx) => {
				const calls = ctx.get("calls") || [];
				calls.push("handler");
				return ctx.json(calls);
			});

			// Mount the sub-app
			app.route("/mounted", subApp);

			const res = await app.handle(mockRequest("/mounted/test"));
			const executionOrder = await res.json();

			// Verify middleware execution order:
			// 1. Main app middleware (global)
			// 2. Main app middleware (scoped to /mounted/*)
			// 3. Sub app middleware (global, now scoped to /mounted/*)
			// 4. Sub app middleware (scoped to /test, now scoped to /mounted/test)
			// 5. Route handler
			expect(executionOrder).toEqual(["main-1", "main-scoped", "sub-global", "sub-scoped", "handler"]);
		});

		it("should handle scope() with middleware correctly", async () => {
			const app = new Web<{ scopeAuth: boolean; userId?: string }>();

			// Create a scoped application with middleware
			app.scope("/users", (userApp) => {
				// Add authentication middleware to the scope
				userApp.use(async (ctx, next) => {
					const authHeader = ctx.req.headers.get("Authorization");
					if (!authHeader) {
						return ctx.json({ error: "Authentication required" }, 401);
					}
					ctx.set("scopeAuth", true);
					await next();
				});

				// Add parameter-specific middleware
				userApp.use("/:id", async (ctx, next) => {
					ctx.set("userId", ctx.params.id);
					await next();
				});

				// Add routes
				userApp.get("/", (ctx) => {
					return ctx.json({
						authenticated: ctx.get("scopeAuth"),
						route: "user list",
					});
				});

				userApp.get("/:id", (ctx) => {
					return ctx.json({
						authenticated: ctx.get("scopeAuth"),
						userId: ctx.get("userId"),
						route: "user detail",
					});
				});
			});

			// Test without authentication - should be blocked
			const unauthorizedRes = await app.handle(mockRequest("/users"));
			expect(unauthorizedRes.status).toBe(401);
			expect(await unauthorizedRes.json()).toEqual({
				error: "Authentication required",
			});

			// Test with authentication - user list
			const userListRes = await app.handle(mockRequest("/users", "GET", { Authorization: "Bearer token" }));
			expect(await userListRes.json()).toEqual({
				authenticated: true,
				route: "user list",
			});

			// Test with authentication - user detail (should also execute parameter middleware)
			const userDetailRes = await app.handle(mockRequest("/users/123", "GET", { Authorization: "Bearer token" }));
			expect(await userDetailRes.json()).toEqual({
				authenticated: true,
				userId: "123",
				route: "user detail",
			});
		});

		it("should not duplicate middleware when using scope() followed by route()", async () => {
			const app = new Web<{ count: number }>();

			// Create a sub-app with middleware
			const subApp = new Web<{ count: number }>();
			subApp.use(async (ctx, next) => {
				const count = ctx.get("count") || 0;
				ctx.set("count", count + 1);
				await next();
			});

			subApp.get("/test", (ctx) => {
				return ctx.text(ctx.get("count").toString());
			});

			// First mount using scope() - this should copy middleware
			app.scope("/scoped", (scopedApp) => {
				scopedApp.route("/sub", subApp);
			});

			// Test that middleware executes only once
			const res = await app.handle(mockRequest("/scoped/sub/test"));
			expect(await res.text()).toBe("1"); // Should be 1, not 2 (which would indicate duplication)
		});

		it("should handle middleware removal after route mounting", async () => {
			const app = new Web<{ protected: boolean }>();
			const api = new Web<{ protected: boolean }>();

			// Add middleware to sub-app
			api.use(async (ctx, next) => {
				ctx.set("protected", true);
				await next();
			});

			api.get("/data", (ctx) => {
				return ctx.json({ protected: ctx.get("protected") || false });
			});

			// Mount the API
			app.route("/api", api);

			// Should work with middleware initially
			let res = await app.handle(mockRequest("/api/data"));
			expect(await res.json()).toEqual({ protected: true });

			// Find and remove the copied middleware
			const middlewares = app.getMiddlewares();
			const copiedMiddleware = middlewares.find((mw) => mw.path === "/api");
			expect(copiedMiddleware).toBeDefined();

			if (copiedMiddleware) {
				const removed = app.removeMiddleware(copiedMiddleware.id);
				expect(removed).toBe(true);
			}

			// Should work without middleware after removal
			res = await app.handle(mockRequest("/api/data"));
			expect(await res.json()).toEqual({ protected: false });
		});
	});

	describe("Route Removal", () => {
		it("should remove routes by ID", async () => {
			const app = new Web();
			const routeId = app.addRoute("GET", "/test", (c) => c.text("Test"));

			// Route should work initially
			let res = await app.handle(mockRequest("/test"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Test");

			// Remove the route
			const removed = app.removeRoute(routeId);
			expect(removed).toBe(true);

			// Route should now return 404
			res = await app.handle(mockRequest("/test"));
			expect(res.status).toBe(404);
		});

		it("should return false when removing non-existent route", async () => {
			const app = new Web();
			const removed = app.removeRoute("non-existent-id");
			expect(removed).toBe(false);
		});

		it("should remove routes with parameters", async () => {
			const app = new Web();
			const routeId = app.addRoute("GET", "/users/:id", (c) => c.text(`User ${c.params.id}`));

			// Route should work initially
			let res = await app.handle(mockRequest("/users/123"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("User 123");

			// Remove the route
			app.removeRoute(routeId);

			// Route should now return 404
			res = await app.handle(mockRequest("/users/123"));
			expect(res.status).toBe(404);
		});

		it("should remove wildcard routes", async () => {
			const app = new Web();
			const routeId = app.addRoute("GET", "/assets/*", (c) => c.text(`Path: ${c.params["*"]}`));

			// Route should work initially
			let res = await app.handle(mockRequest("/assets/images/logo.png"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("Path: images/logo.png");

			// Remove the route
			app.removeRoute(routeId);

			// Route should now return 404
			res = await app.handle(mockRequest("/assets/images/logo.png"));
			expect(res.status).toBe(404);
		});

		it("should remove routes by method and path criteria", async () => {
			const app = new Web();
			app.get("/users", (c) => c.text("GET Users"));
			app.post("/users", (c) => c.text("POST Users"));
			app.get("/posts", (c) => c.text("GET Posts"));

			// All routes should work initially
			expect((await app.handle(mockRequest("/users", "GET"))).status).toBe(200);
			expect((await app.handle(mockRequest("/users", "POST"))).status).toBe(200);
			expect((await app.handle(mockRequest("/posts", "GET"))).status).toBe(200);

			// Remove only GET routes
			const removedCount = app.removeRoutesBy({ method: "GET" });
			expect(removedCount).toBe(2);

			// GET routes should return 404, POST should still work
			expect((await app.handle(mockRequest("/users", "GET"))).status).toBe(404);
			expect((await app.handle(mockRequest("/posts", "GET"))).status).toBe(404);
			expect((await app.handle(mockRequest("/users", "POST"))).status).toBe(200);
		});

		it("should remove routes by path criteria", async () => {
			const app = new Web();
			app.get("/users", (c) => c.text("GET Users"));
			app.post("/users", (c) => c.text("POST Users"));
			app.get("/posts", (c) => c.text("GET Posts"));

			// Remove all /users routes
			const removedCount = app.removeRoutesBy({ path: "/users" });
			expect(removedCount).toBe(2);

			// /users routes should return 404, /posts should still work
			expect((await app.handle(mockRequest("/users", "GET"))).status).toBe(404);
			expect((await app.handle(mockRequest("/users", "POST"))).status).toBe(404);
			expect((await app.handle(mockRequest("/posts", "GET"))).status).toBe(200);
		});

		it("should remove routes by specific method and path", async () => {
			const app = new Web();
			app.get("/users", (c) => c.text("GET Users"));
			app.post("/users", (c) => c.text("POST Users"));

			// Remove only GET /users
			const removedCount = app.removeRoutesBy({ method: "GET", path: "/users" });
			expect(removedCount).toBe(1);

			// Only GET should return 404, POST should still work
			expect((await app.handle(mockRequest("/users", "GET"))).status).toBe(404);
			expect((await app.handle(mockRequest("/users", "POST"))).status).toBe(200);
		});

		it("should get all routes with metadata", async () => {
			const app = new Web();
			const getId = app.addRoute("GET", "/users/:id", (c) => c.text("Get User"));
			const postId = app.addRoute("POST", "/users", (c) => c.text("Create User"));

			const routes = app.getRoutes();
			expect(routes).toHaveLength(2);

			const getRoute = routes.find((r) => r.id === getId);
			const postRoute = routes.find((r) => r.id === postId);

			expect(getRoute).toEqual({ id: getId, method: "GET", path: "/users/:id" });
			expect(postRoute).toEqual({ id: postId, method: "POST", path: "/users" });
		});

		it("should handle route removal with remaining routes", async () => {
			const app = new Web();
			const route1Id = app.addRoute("GET", "/route1", (c) => c.text("Route 1"));
			const route2Id = app.addRoute("GET", "/route2", (c) => c.text("Route 2"));
			const route3Id = app.addRoute("GET", "/route3", (c) => c.text("Route 3"));

			// All routes should work
			expect((await app.handle(mockRequest("/route1"))).status).toBe(200);
			expect((await app.handle(mockRequest("/route2"))).status).toBe(200);
			expect((await app.handle(mockRequest("/route3"))).status).toBe(200);

			// Remove middle route
			app.removeRoute(route2Id);

			// Route 1 and 3 should still work, route 2 should not
			expect((await app.handle(mockRequest("/route1"))).status).toBe(200);
			expect((await app.handle(mockRequest("/route2"))).status).toBe(404);
			expect((await app.handle(mockRequest("/route3"))).status).toBe(200);
		});
	});

	describe("Middleware Removal", () => {
		it("should remove middleware by ID", async () => {
			const app = new Web<{ flag: string }>();
			const calls: string[] = [];

			const middlewareId = app.addMiddleware(async (c, next) => {
				calls.push("middleware");
				c.set("flag", "set");
				await next();
			});

			app.get("/test", (c) => {
				calls.push("handler");
				return c.text(c.get("flag") || "not set");
			});

			// Middleware should execute initially
			let res = await app.handle(mockRequest("/test"));
			expect(await res.text()).toBe("set");
			expect(calls).toEqual(["middleware", "handler"]);

			// Remove middleware
			calls.length = 0;
			const removed = app.removeMiddleware(middlewareId);
			expect(removed).toBe(true);

			// Middleware should not execute after removal
			res = await app.handle(mockRequest("/test"));
			expect(await res.text()).toBe("not set");
			expect(calls).toEqual(["handler"]);
		});

		it("should return false when removing non-existent middleware", async () => {
			const app = new Web();
			const removed = app.removeMiddleware("non-existent-id");
			expect(removed).toBe(false);
		});

		it("should remove scoped middleware", async () => {
			const app = new Web<{ role: string }>();

			const middlewareId = app.addMiddleware("/admin/*", async (c, next) => {
				c.set("role", "admin");
				await next();
			});

			app.get("/admin/dashboard", (c) => c.text(c.get("role") || "none"));
			app.get("/public", (c) => c.text(c.get("role") || "none"));

			// Middleware should work initially for /admin routes
			let res = await app.handle(mockRequest("/admin/dashboard"));
			expect(await res.text()).toBe("admin");

			// Remove scoped middleware
			app.removeMiddleware(middlewareId);

			// Admin route should no longer have the role set
			res = await app.handle(mockRequest("/admin/dashboard"));
			expect(await res.text()).toBe("none");

			// Public route should be unaffected
			res = await app.handle(mockRequest("/public"));
			expect(await res.text()).toBe("none");
		});

		it("should remove method-specific middleware", async () => {
			const app = new Web<{ flag: string }>();

			const middlewareId = app.addMiddleware("POST", "/users", async (c, next) => {
				c.set("flag", "post-middleware");
				await next();
			});

			app.get("/users", (c) => c.text(c.get("flag") || "no-flag"));
			app.post("/users", (c) => c.text(c.get("flag") || "no-flag"));

			// POST middleware should work initially
			let res = await app.handle(mockRequest("/users", "POST"));
			expect(await res.text()).toBe("post-middleware");

			// GET should not have the flag
			res = await app.handle(mockRequest("/users", "GET"));
			expect(await res.text()).toBe("no-flag");

			// Remove POST middleware
			app.removeMiddleware(middlewareId);

			// POST should no longer have the flag
			res = await app.handle(mockRequest("/users", "POST"));
			expect(await res.text()).toBe("no-flag");
		});

		it("should remove middleware by method criteria", async () => {
			const app = new Web<{ flag: string }>();

			app.use("GET", "/test", async (c, next) => {
				c.set("flag", "get-middleware");
				await next();
			});

			app.use("POST", "/test", async (c, next) => {
				c.set("flag", "post-middleware");
				await next();
			});

			app.use("/other", async (c, next) => {
				c.set("flag", "other-middleware");
				await next();
			});

			app.get("/test", (c) => c.text(c.get("flag") || "no-flag"));
			app.post("/test", (c) => c.text(c.get("flag") || "no-flag"));
			app.get("/other", (c) => c.text(c.get("flag") || "no-flag"));

			// All middleware should work initially
			expect(await (await app.handle(mockRequest("/test", "GET"))).text()).toBe("get-middleware");
			expect(await (await app.handle(mockRequest("/test", "POST"))).text()).toBe("post-middleware");
			expect(await (await app.handle(mockRequest("/other", "GET"))).text()).toBe("other-middleware");

			// Remove all GET middleware
			const removedCount = app.removeMiddlewareBy({ method: "GET" });
			expect(removedCount).toBe(1);

			// GET middleware should be removed, others should remain
			expect(await (await app.handle(mockRequest("/test", "GET"))).text()).toBe("no-flag");
			expect(await (await app.handle(mockRequest("/test", "POST"))).text()).toBe("post-middleware");
			expect(await (await app.handle(mockRequest("/other", "GET"))).text()).toBe("other-middleware");
		});

		it("should remove middleware by path criteria", async () => {
			const app = new Web<{ flag: string }>();

			app.use("/admin", async (c, next) => {
				c.set("flag", "admin-middleware");
				await next();
			});

			app.use("/public", async (c, next) => {
				c.set("flag", "public-middleware");
				await next();
			});

			app.get("/admin", (c) => c.text(c.get("flag") || "no-flag"));
			app.get("/public", (c) => c.text(c.get("flag") || "no-flag"));

			// All middleware should work initially
			expect(await (await app.handle(mockRequest("/admin"))).text()).toBe("admin-middleware");
			expect(await (await app.handle(mockRequest("/public"))).text()).toBe("public-middleware");

			// Remove /admin middleware
			const removedCount = app.removeMiddlewareBy({ path: "/admin" });
			expect(removedCount).toBe(1);

			// Admin middleware should be removed, public should remain
			expect(await (await app.handle(mockRequest("/admin"))).text()).toBe("no-flag");
			expect(await (await app.handle(mockRequest("/public"))).text()).toBe("public-middleware");
		});

		it("should get all middleware with metadata", async () => {
			const app = new Web();
			const globalId = app.addMiddleware(async (c, next) => await next());
			const pathId = app.addMiddleware("/admin", async (c, next) => await next());
			const methodId = app.addMiddleware("POST", "/users", async (c, next) => await next());

			const middlewares = app.getMiddlewares();
			expect(middlewares).toHaveLength(3);

			const globalMw = middlewares.find((m) => m.id === globalId);
			const pathMw = middlewares.find((m) => m.id === pathId);
			const methodMw = middlewares.find((m) => m.id === methodId);

			expect(globalMw).toEqual({ id: globalId, method: undefined, path: undefined });
			expect(pathMw).toEqual({ id: pathId, method: undefined, path: "/admin" });
			expect(methodMw).toEqual({ id: methodId, method: "POST", path: "/users" });
		});

		it("should handle multiple middleware removal", async () => {
			const app = new Web<{ calls: string[] }>();

			const id1 = app.addMiddleware(async (c, next) => {
				const calls = c.get("calls") || [];
				calls.push("mw1");
				c.set("calls", calls);
				await next();
			});

			const id2 = app.addMiddleware(async (c, next) => {
				const calls = c.get("calls") || [];
				calls.push("mw2");
				c.set("calls", calls);
				await next();
			});

			const id3 = app.addMiddleware(async (c, next) => {
				const calls = c.get("calls") || [];
				calls.push("mw3");
				c.set("calls", calls);
				await next();
			});

			app.get("/test", (c) => {
				const calls = c.get("calls") || [];
				calls.push("handler");
				return c.json(calls);
			});

			// All middleware should execute
			let res = await app.handle(mockRequest("/test"));
			expect(await res.json()).toEqual(["mw1", "mw2", "mw3", "handler"]);

			// Remove middle middleware
			app.removeMiddleware(id2);

			res = await app.handle(mockRequest("/test"));
			expect(await res.json()).toEqual(["mw1", "mw3", "handler"]);

			// Remove first middleware
			app.removeMiddleware(id1);

			res = await app.handle(mockRequest("/test"));
			expect(await res.json()).toEqual(["mw3", "handler"]);
		});
	});

	describe("Application Clear", () => {
		it("should clear all routes and middleware", async () => {
			const app = new Web<{ flag: string }>();

			// Add routes and middleware
			app.use(async (c, next) => {
				c.set("flag", "middleware");
				await next();
			});

			app.get("/test1", (c) => c.text("Test 1"));
			app.post("/test2", (c) => c.text("Test 2"));

			// Should work initially
			expect((await app.handle(mockRequest("/test1"))).status).toBe(200);
			expect((await app.handle(mockRequest("/test2", "POST"))).status).toBe(200);

			// Clear everything
			app.clear();

			// Nothing should work after clear
			expect((await app.handle(mockRequest("/test1"))).status).toBe(404);
			expect((await app.handle(mockRequest("/test2", "POST"))).status).toBe(404);

			// Metadata should be empty
			expect(app.getRoutes()).toHaveLength(0);
			expect(app.getMiddlewares()).toHaveLength(0);
		});

		it("should allow adding new routes after clear", async () => {
			const app = new Web();

			// Add initial route
			app.get("/old", (c) => c.text("Old"));

			// Clear and add new route
			app.clear();
			app.get("/new", (c) => c.text("New"));

			// Only new route should work
			expect((await app.handle(mockRequest("/old"))).status).toBe(404);

			const res = await app.handle(mockRequest("/new"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("New");
		});
	});

	describe("Complex Removal Scenarios", () => {
		it("should handle removal with route parameters and middleware interaction", async () => {
			const app = new Web<{ userId: string }>();

			const middlewareId = app.addMiddleware("/users/:id", async (c, next) => {
				c.set("userId", c.params.id);
				await next();
			});

			const routeId = app.addRoute("GET", "/users/:id", (c) => {
				return c.text(`User: ${c.get("userId") || ""}`);
			});

			// Should work with middleware
			let res = await app.handle(mockRequest("/users/123"));
			expect(await res.text()).toBe("User: 123");

			// Remove middleware but keep route
			app.removeMiddleware(middlewareId);

			res = await app.handle(mockRequest("/users/123"));
			expect(await res.text()).toBe("User: "); // No middleware to set userId

			// Remove route
			app.removeRoute(routeId);

			res = await app.handle(mockRequest("/users/123"));
			expect(res.status).toBe(404);
		});

		it("should maintain performance after route removal", async () => {
			const app = new Web();

			// Add many routes
			const routeIds: string[] = [];
			for (let i = 0; i < 50; i++) {
				const id = app.addRoute("GET", `/route${i}`, (c) => c.text(`Route ${i}`));
				routeIds.push(id);
			}

			// Remove every other route
			for (let i = 0; i < routeIds.length; i += 2) {
				app.removeRoute(routeIds[i]);
			}

			// Remaining routes should still work efficiently
			const res1 = await app.handle(mockRequest("/route1"));
			expect(await res1.text()).toBe("Route 1");

			const res49 = await app.handle(mockRequest("/route49"));
			expect(await res49.text()).toBe("Route 49");

			// Removed routes should return 404
			const res0 = await app.handle(mockRequest("/route0"));
			expect(res0.status).toBe(404);

			const res48 = await app.handle(mockRequest("/route48"));
			expect(res48.status).toBe(404);
		});

		it("should handle route removal with scoped applications", async () => {
			const app = new Web();

			// Create scoped app
			app.scope("/api/v1", (api) => {
				api.get("/users", (c) => c.text("API Users"));
				api.get("/posts", (c) => c.text("API Posts"));
			});

			// Should work initially
			expect((await app.handle(mockRequest("/api/v1/users"))).status).toBe(200);
			expect((await app.handle(mockRequest("/api/v1/posts"))).status).toBe(200);

			// Remove specific scoped route
			const routes = app.getRoutes();
			const usersRoute = routes.find((r) => r.path === "/api/v1/users");
			if (usersRoute) {
				app.removeRoute(usersRoute.id);
			}

			// Only users route should be gone
			expect((await app.handle(mockRequest("/api/v1/users"))).status).toBe(404);
			expect((await app.handle(mockRequest("/api/v1/posts"))).status).toBe(200);
		});
	});

	describe("Request Handling", () => {
		it("should parse JSON body", async () => {
			const app = new Web();
			app.post("/echo", async (c) => {
				const data = await c.req.json();
				return c.json(data);
			});

			const res = await app.handle(
				new Request("http://localhost/echo", {
					method: "POST",
					body: JSON.stringify({ message: "hello" }),
					headers: { "Content-Type": "application/json" },
				})
			);

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ message: "hello" });
		});

		it("should parse form data", async () => {
			const app = new Web();
			app.post("/form", async (c) => {
				const form = await c.req.formData();
				return c.text(form.get("name") as string);
			});

			const formData = new FormData();
			formData.append("name", "John");

			const res = await app.handle(
				new Request("http://localhost/form", {
					method: "POST",
					body: formData,
				})
			);

			expect(res.status).toBe(200);
			expect(await res.text()).toBe("John");
		});

		it("should parse query parameters", async () => {
			const app = new Web();
			app.get("/search", (c) => {
				const query = c.query();
				return c.json({
					q: query.get("q"),
					page: query.get("page"),
				});
			});

			const res = await app.handle(mockRequest("/search?q=test&page=2"));
			expect(await res.json()).toEqual({ q: "test", page: "2" });
		});

		it("should handle headers", async () => {
			const app = new Web();
			app.get("/headers", (c) => {
				return c.json({
					userAgent: c.req.headers.get("User-Agent"),
				});
			});

			const res = await app.handle(mockRequest("/headers", "GET", { "User-Agent": "TestAgent" }));
			expect(await res.json()).toEqual({ userAgent: "TestAgent" });
		});
	});

	describe("Response Handling", () => {
		it("should set response headers", async () => {
			const app = new Web();
			app.get("/headers", (c) => {
				return c.text("OK", 200, {
					"X-Custom": "value",
				});
			});

			const res = await app.handle(mockRequest("/headers"));
			expect(res.headers.get("X-Custom")).toBe("value");
		});

		it("should return JSON responses", async () => {
			const app = new Web();
			app.get("/json", (c) => c.json({ status: "ok" }));

			const res = await app.handle(mockRequest("/json"));
			expect(res.headers.get("Content-Type")).toContain("application/json");
			expect(await res.json()).toEqual({ status: "ok" });
		});

		it("should return HTML responses", async () => {
			const app = new Web();
			app.get("/html", (c) => c.html("<h1>Hello</h1>"));

			const res = await app.handle(mockRequest("/html"));
			expect(res.headers.get("Content-Type")).toContain("text/html");
			expect(await res.text()).toBe("<h1>Hello</h1>");
		});

		it("should handle redirects", async () => {
			const app = new Web();
			app.get("/old", (c) => c.redirect("/new"));

			const res = await app.handle(mockRequest("/old"));
			expect(res.status).toBe(302);
			expect(res.headers.get("Location")).toBe("/new");
		});
	});

	describe("Error Handling", () => {
		it("should handle 404 not found", async () => {
			const app = new Web();
			app.get("/exists", (c) => c.text("OK"));

			const res = await app.handle(mockRequest("/not-found"));
			expect(res.status).toBe(404);
		});

		it("should handle route errors", async () => {
			const app = new Web();
			app.get("/error", () => {
				throw new Error("Test error");
			});

			const res = await app.handle(mockRequest("/error"));
			expect(res.status).toBe(500);
		});

		it("should support custom error handling", async () => {
			const app = new Web();

			app.onError((err, c) => {
				return c.text(`Error: ${err.message}`, 500);
			});

			app.get("/error", () => {
				throw new Error("Custom error");
			});

			const res = await app.handle(mockRequest("/error"));
			expect(await res.text()).toBe("Error: Custom error");
		});

		it("should handle async errors", async () => {
			const app = new Web();
			app.get("/async-error", async () => {
				throw new Error("Async error");
			});

			const res = await app.handle(mockRequest("/async-error"));
			expect(res.status).toBe(500);
		});

		it("should handle errors after route removal", async () => {
			const app = new Web();

			app.onError((err, c) => {
				return c.text(`Handled: ${err.message}`, 500);
			});

			const routeId = app.addRoute("GET", "/error", () => {
				throw new Error("Route error");
			});

			// Error should be handled initially
			let res = await app.handle(mockRequest("/error"));
			expect(await res.text()).toBe("Handled: Route error");

			// Remove route
			app.removeRoute(routeId);

			// Should return 404, not error handler
			res = await app.handle(mockRequest("/error"));
			expect(res.status).toBe(404);
		});
	});

	describe("Route Groups", () => {
		it("should support route prefixes", async () => {
			const app = new Web();

			const api = new Web();
			api.get("/users", (c) => c.text("API Users"));

			app.route("/api", api);

			const res = await app.handle(mockRequest("/api/users"));
			expect(await res.text()).toBe("API Users");
		});

		it("should support nested route groups", async () => {
			const app = new Web();

			const v1 = new Web();
			v1.get("/users", (c) => c.text("V1 Users"));

			const api = new Web();
			api.route("/v1", v1);

			app.route("/api", api);

			const res = await app.handle(mockRequest("/api/v1/users"));
			expect(await res.text()).toBe("V1 Users");
		});

		it("should inherit middleware in route groups", async () => {
			const app = new Web<{ "x-request-id": string }>();

			app.use(async (c, next) => {
				c.set("x-request-id", "123");
				await next();
			});

			const api = new Web<{ "x-request-id": string }>();
			api.get("/test", (c) => c.text(c.get("x-request-id")));

			app.route("/api", api);

			const res = await app.handle(mockRequest("/api/test"));
			expect(await res.text()).toBe("123");
		});
	});

	describe("State Management", () => {
		it("should share state between middleware and handlers", async () => {
			const app = new Web();

			app.use(async (c, next) => {
				c.set("user", { id: 123 });
				await next();
			});

			app.get("/user", (c) => c.json(c.get("user")));

			const res = await app.handle(mockRequest("/user"));
			expect(await res.json()).toEqual({ id: 123 });
		});

		it("should isolate state between requests", async () => {
			const app = new Web<{ count: number }>();

			app.use(async (c, next) => {
				c.set("count", (c.get("count") || 0) + 1);
				await next();
			});

			app.get("/count", (c) => c.text(c.get("count").toString()));

			const res1 = await app.handle(mockRequest("/count"));
			expect(await res1.text()).toBe("1");

			const res2 = await app.handle(mockRequest("/count"));
			expect(await res2.text()).toBe("1");
		});
	});

	describe("Performance", () => {
		it("should handle many routes efficiently", async () => {
			const app = new Web();

			// Add 100 routes
			for (let i = 0; i < 100; i++) {
				app.get(`/route${i}`, (c) => c.text(`Route ${i}`));
			}

			// Test a few of them
			const res1 = await app.handle(mockRequest("/route0"));
			expect(await res1.text()).toBe("Route 0");

			const res50 = await app.handle(mockRequest("/route50"));
			expect(await res50.text()).toBe("Route 50");

			const res99 = await app.handle(mockRequest("/route99"));
			expect(await res99.text()).toBe("Route 99");
		});

		it("should maintain performance after bulk operations", async () => {
			const app = new Web();

			// Add many routes and middleware
			const routeIds: string[] = [];
			const middlewareIds: string[] = [];

			for (let i = 0; i < 50; i++) {
				const routeId = app.addRoute("GET", `/route${i}`, (c) => c.text(`Route ${i}`));
				const middlewareId = app.addMiddleware(`/route${i}`, async (c, next) => {
					c.set("processed", true);
					await next();
				});
				routeIds.push(routeId);
				middlewareIds.push(middlewareId);
			}

			// Remove half of them
			for (let i = 0; i < 25; i++) {
				app.removeRoute(routeIds[i * 2]);
				app.removeMiddleware(middlewareIds[i * 2]);
			}

			// Remaining routes should still work quickly
			const start = Date.now();

			for (let i = 1; i < 50; i += 2) {
				const res = await app.handle(mockRequest(`/route${i}`));
				expect(res.status).toBe(200);
			}

			const elapsed = Date.now() - start;
			// Should process 25 routes very quickly (< 100ms is generous for this test)
			expect(elapsed).toBeLessThan(100);
		});
	});

	describe("Edge Cases and Regression Tests", () => {
		it("should handle removing routes with same path but different methods", async () => {
			const app = new Web();

			const getId = app.addRoute("GET", "/users", (c) => c.text("GET"));
			const postId = app.addRoute("POST", "/users", (c) => c.text("POST"));
			const putId = app.addRoute("PUT", "/users", (c) => c.text("PUT"));

			// All should work initially
			expect(await (await app.handle(mockRequest("/users", "GET"))).text()).toBe("GET");
			expect(await (await app.handle(mockRequest("/users", "POST"))).text()).toBe("POST");
			expect(await (await app.handle(mockRequest("/users", "PUT"))).text()).toBe("PUT");

			// Remove just the GET route
			app.removeRoute(getId);

			// GET should be gone, others should remain
			expect((await app.handle(mockRequest("/users", "GET"))).status).toBe(404);
			expect(await (await app.handle(mockRequest("/users", "POST"))).text()).toBe("POST");
			expect(await (await app.handle(mockRequest("/users", "PUT"))).text()).toBe("PUT");
		});

		it("should handle removing middleware that doesn't match current routes", async () => {
			const app = new Web<{ flag: string }>();

			// Add middleware for a path that doesn't have routes
			const middlewareId = app.addMiddleware("/nonexistent", async (c, next) => {
				c.set("flag", "should-not-execute");
				await next();
			});

			app.get("/test", (c) => c.text(c.get("flag") || "no-flag"));

			// Middleware shouldn't affect unrelated routes
			let res = await app.handle(mockRequest("/test"));
			expect(await res.text()).toBe("no-flag");

			// Should be able to remove the unused middleware
			const removed = app.removeMiddleware(middlewareId);
			expect(removed).toBe(true);

			// Route should still work the same way
			res = await app.handle(mockRequest("/test"));
			expect(await res.text()).toBe("no-flag");
		});

		it("should handle rapid add/remove operations", async () => {
			const app = new Web();

			// Rapidly add and remove routes
			for (let i = 0; i < 10; i++) {
				const routeId = app.addRoute("GET", `/temp${i}`, (c) => c.text(`Temp ${i}`));

				// Verify it works
				let res = await app.handle(mockRequest(`/temp${i}`));
				expect(await res.text()).toBe(`Temp ${i}`);

				// Remove it immediately
				app.removeRoute(routeId);

				// Verify it's gone
				res = await app.handle(mockRequest(`/temp${i}`));
				expect(res.status).toBe(404);
			}

			// App should still be functional
			const finalId = app.addRoute("GET", "/final", (c) => c.text("Final"));
			const res = await app.handle(mockRequest("/final"));
			expect(await res.text()).toBe("Final");

			expect(app.getRoutes()).toHaveLength(1);
			expect(app.getRoutes()[0].id).toBe(finalId);
		});

		it("should properly handle route removal with complex parameter patterns", async () => {
			const app = new Web();

			const route1Id = app.addRoute("GET", "/users/:id", (c) => c.text(`User ${c.params.id}`));
			const route2Id = app.addRoute("GET", "/users/:id/posts/:postId", (c) => c.text(`User ${c.params.id}, Post ${c.params.postId}`));
			const route3Id = app.addRoute("GET", "/users/:id/*", (c) => c.text(`User ${c.params.id}, Path ${c.params["*"]}`));

			// All should work
			expect(await (await app.handle(mockRequest("/users/123"))).text()).toBe("User 123");
			expect(await (await app.handle(mockRequest("/users/123/posts/456"))).text()).toBe("User 123, Post 456");
			expect(await (await app.handle(mockRequest("/users/123/profile/settings"))).text()).toBe("User 123, Path profile/settings");

			// Remove the wildcard route
			app.removeRoute(route3Id);

			// Specific routes should still work, wildcard should not
			expect(await (await app.handle(mockRequest("/users/123"))).text()).toBe("User 123");
			expect(await (await app.handle(mockRequest("/users/123/posts/456"))).text()).toBe("User 123, Post 456");
			expect((await app.handle(mockRequest("/users/123/profile/settings"))).status).toBe(404);

			// Remove the parameter route
			app.removeRoute(route1Id);

			// Only the specific nested route should work
			expect((await app.handle(mockRequest("/users/123"))).status).toBe(404);
			expect(await (await app.handle(mockRequest("/users/123/posts/456"))).text()).toBe("User 123, Post 456");
		});

		it("should handle empty criteria in bulk removal methods", async () => {
			const app = new Web();

			app.get("/test1", (c) => c.text("Test 1"));
			app.post("/test2", (c) => c.text("Test 2"));

			// Empty criteria should remove nothing
			const removedRoutes = app.removeRoutesBy({});
			expect(removedRoutes).toBe(0);

			const removedMiddleware = app.removeMiddlewareBy({});
			expect(removedMiddleware).toBe(0);

			// Routes should still work
			expect((await app.handle(mockRequest("/test1"))).status).toBe(200);
			expect((await app.handle(mockRequest("/test2", "POST"))).status).toBe(200);
		});
	});
});
