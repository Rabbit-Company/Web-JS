import { describe, expect, it } from "bun:test";
import { Web } from "../src/index";

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
	});
});
