import { describe, expect, it } from "bun:test";
import { Web } from "../src/index";

function mockRequest(path: string, method = "GET") {
	return new Request(`http://localhost${path}`, { method });
}

describe("Web Framework", () => {
	it("should handle basic GET route", async () => {
		const app = new Web();
		app.get("/hello", (ctx) => ctx.text("Hello World"));

		const res = await app.handle(mockRequest("/hello"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("Hello World");
	});

	it("should call middleware before handler", async () => {
		const app = new Web();

		let called = false;
		app.use(async (_ctx, next) => {
			called = true;
			await next();
		});

		app.get("/test", (ctx) => ctx.text("Test"));

		const res = await app.handle(mockRequest("/test"));
		expect(res.status).toBe(200);
		expect(called).toBe(true);
	});

	it("should support dynamic route params", async () => {
		const app = new Web();
		app.get("/user/:id", (ctx) => ctx.text(`User ${ctx.params.id}`));

		const res = await app.handle(mockRequest("/user/42"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("User 42");
	});

	it("should support multiple middlewares and short-circuiting", async () => {
		const app = new Web();

		app.use(() => new Response("Intercepted", { status: 401 }));

		app.get("/private", (ctx) => ctx.text("Secret"));

		const res = await app.handle(mockRequest("/private"));
		expect(res.status).toBe(401);
		expect(await res.text()).toBe("Intercepted");
	});

	it("should support wildcard routes", async () => {
		const app = new Web();
		app.get("/assets/*", (ctx) => ctx.text("Asset route"));

		const res = await app.handle(mockRequest("/assets/images/logo.png"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("Asset route");
	});

	it("should respond with JSON using ctx.json", async () => {
		const app = new Web();
		app.get("/data", (ctx) => ctx.json({ foo: "bar" }));

		const res = await app.handle(mockRequest("/data"));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("application/json");
		expect(await res.json()).toEqual({ foo: "bar" });
	});

	it("should respond with HTML using ctx.html", async () => {
		const app = new Web();
		app.get("/page", (ctx) => ctx.html("<h1>Hello Page</h1>"));

		const res = await app.handle(mockRequest("/page"));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/html");
		expect(await res.text()).toContain("<h1>Hello Page</h1>");
	});

	it("should parse query params", async () => {
		const app = new Web();
		app.get("/search", (ctx) => ctx.text(ctx.query().get("q") || ""));

		const res = await app.handle(mockRequest("/search?q=test"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("test");
	});

	it("should parse body JSON using ctx.body", async () => {
		const app = new Web();
		app.post("/echo", async (ctx) => {
			const body = await ctx.body<{ msg: string }>();
			return ctx.text(body.msg);
		});

		const res = await app.handle(
			new Request("http://localhost/echo", {
				method: "POST",
				body: JSON.stringify({ msg: "Hello" }),
				headers: { "Content-Type": "application/json" },
			})
		);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("Hello");
	});

	it("should return HTML content with ctx.html", async () => {
		const app = new Web();
		app.get("/page", (ctx) => ctx.html("<h1>Hello</h1>"));

		const res = await app.handle(mockRequest("/page"));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/html");
		expect(await res.text()).toBe("<h1>Hello</h1>");
	});

	it("should support route groups (mounting)", async () => {
		const users = new Web();
		users.get("/", (ctx) => ctx.text("List users"));
		users.get("/:id", (ctx) => ctx.text(`User ${ctx.params.id}`));

		const app = new Web().route("/users", users);

		const res1 = await app.handle(mockRequest("/users/123"));
		expect(res1.status).toBe(200);
		expect(await res1.text()).toBe("User 123");

		const res2 = await app.handle(mockRequest("/users"));
		expect(res2.status).toBe(200);
		expect(await res2.text()).toBe("List users");
	});

	it("should return 404 for unmatched route", async () => {
		const app = new Web();
		const res = await app.handle(mockRequest("/nope"));
		expect(res.status).toBe(404);
	});

	it("should return 404 when dynamic param is missing", async () => {
		const app = new Web();
		app.get("/user/:id", (ctx) => ctx.text(`User ${ctx.params.id}`));

		const res = await app.handle(mockRequest("/user"));
		expect(res.status).toBe(404);
	});

	it("should return 500 on handler error", async () => {
		const app = new Web();
		app.get("/fail", () => {
			throw new Error("Boom");
		});

		const res = await app.handle(mockRequest("/fail"));
		expect(res.status).toBe(500);
		expect(await res.text()).toBe("Internal Server Error");
	});

	describe("State Management", () => {
		it("should share state between middlewares and handlers", async () => {
			const app = new Web();

			app.use(async (ctx, next) => {
				ctx.state.user = { id: 123 };
				await next();
			});

			app.get("/profile", (ctx) => ctx.json({ userId: (ctx.state.user as { id: number }).id }));

			const res = await app.handle(mockRequest("/profile"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ userId: 123 });
		});

		it("should isolate state between requests", async () => {
			const app = new Web<{ counter: number }>();

			app.use(async (ctx, next) => {
				ctx.state.counter = (ctx.state.counter || 0) + 1;
				await next();
			});

			app.get("/count", (ctx) => ctx.text(`Count: ${ctx.state.counter}`));

			// First request
			const res1 = await app.handle(mockRequest("/count"));
			expect(res1.status).toBe(200);
			expect(await res1.text()).toBe("Count: 1");

			// Second request (should not share state)
			const res2 = await app.handle(mockRequest("/count"));
			expect(res2.status).toBe(200);
			expect(await res2.text()).toBe("Count: 1");
		});
	});

	describe("Scoped Middleware", () => {
		it("should apply middleware only to scoped routes", async () => {
			const app = new Web();

			// Global middleware
			app.use(async (ctx, next) => {
				ctx.state.global = true;
				await next();
			});

			// Scoped middleware
			app.scope("/admin", (admin) => {
				admin.use(async (ctx, next) => {
					ctx.state.admin = true;
					await next();
				});

				admin.get("/dashboard", (ctx) => {
					return ctx.json({
						global: ctx.state.global,
						admin: ctx.state.admin,
					});
				});
			});

			// Regular route (should not get admin middleware)
			app.get("/home", (ctx) => {
				return ctx.json({
					global: ctx.state.global,
					admin: ctx.state.admin,
				});
			});

			// Test admin route
			const adminRes = await app.handle(mockRequest("/admin/dashboard"));
			expect(adminRes.status).toBe(200);
			expect(await adminRes.json()).toEqual({ global: true, admin: true });

			// Test non-admin route
			const homeRes = await app.handle(mockRequest("/home"));
			expect(homeRes.status).toBe(200);
			expect(await homeRes.json()).toEqual({ global: true, admin: undefined });
		});

		it("should support nested scopes", async () => {
			const app = new Web();

			app.scope("/api", (api) => {
				api.use(async (ctx, next) => {
					ctx.state.api = true;
					await next();
				});

				api.scope("/v1", (v1) => {
					v1.use(async (ctx, next) => {
						ctx.state.v1 = true;
						await next();
					});

					v1.get("/users", (ctx) => {
						return ctx.json({
							api: ctx.state.api,
							v1: ctx.state.v1,
						});
					});
				});
			});

			const res = await app.handle(mockRequest("/api/v1/users"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ api: true, v1: true });
		});

		it("should inherit parent middlewares in scopes", async () => {
			const app = new Web();

			app.use(async (ctx, next) => {
				ctx.state.root = true;
				await next();
			});

			app.scope("/admin", (admin) => {
				admin.use(async (ctx, next) => {
					ctx.state.admin = true;
					await next();
				});

				admin.get("/", (ctx) => {
					return ctx.json({
						root: ctx.state.root,
						admin: ctx.state.admin,
					});
				});
			});

			const res = await app.handle(mockRequest("/admin"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ root: true, admin: true });
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty middleware chain", async () => {
			const app = new Web();
			app.get("/empty", async () => {}); // No response returned

			const res = await app.handle(mockRequest("/empty"));
			expect(res.status).toBe(500);
			expect(await res.text()).toBe("No response returned by handler");
		});

		it("should handle middleware that modifies context", async () => {
			const app = new Web();

			app.use(async (ctx, next) => {
				ctx.params.foo = "bar";
				await next();
			});

			app.get("/modify", (ctx) => ctx.text(ctx.params.foo));

			const res = await app.handle(mockRequest("/modify"));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("bar");
		});
	});
});
