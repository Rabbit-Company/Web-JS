import { describe, it, expect } from "bun:test";
import { Web } from "../src/index";
import { Hono } from "hono";
import { Elysia } from "elysia";

function mockRequest(path: string, method = "GET", body?: any) {
	const init: RequestInit = { method };
	if (body) {
		init.body = JSON.stringify(body);
		init.headers = { "Content-Type": "application/json" };
	}
	return new Request(`http://localhost${path}`, init);
}

async function runBenchmark(name: string, handler: (req: Request) => Promise<Response>, requests: Request[], iterations = 1_000_000, warmup = 1_000) {
	let checksum = 0;

	// Warmup
	for (let i = 0; i < warmup; i++) {
		const req = requests[i % requests.length]!.clone();
		const res = await handler(req);
		if (res.headers.get("content-type")?.includes("json")) {
			const data = await res.json();
			checksum += JSON.stringify(data).length;
		} else {
			checksum += (await res.text()).length;
		}
	}

	// Actual benchmark
	const start = performance.now();

	for (let i = 0; i < iterations; i++) {
		const req = requests[i % requests.length]!.clone();
		const res = await handler(req);
		// Consume response to avoid lazy evaluation
		if (res.headers.get("content-type")?.includes("json")) {
			const data = await res.json();
			checksum += JSON.stringify(data).length;
		} else {
			checksum += (await res.text()).length;
		}
	}

	const end = performance.now();
	const duration = end - start;
	const rps = Math.round(iterations / (duration / 1000));

	console.log(`${name}: ${duration.toFixed(2)}ms for ${iterations} requests (${rps.toLocaleString()} req/s) (checksum: ${checksum})`);
	return { duration, rps };
}

describe("Comprehensive Framework Benchmarks", () => {
	describe("Simple Route Benchmark", () => {
		it("benchmarks simple GET route", async () => {
			const requests = [mockRequest("/")];

			// Web Framework
			const webApp = new Web();
			webApp.get("/", (ctx) => ctx.json({ randNumber: Math.floor(Math.random() * 100) }));
			const webResult = await runBenchmark("Web Framework (Simple)", (req) => webApp.handle(req), requests);

			// Hono Framework
			const honoApp = new Hono();
			honoApp.get("/", (c) => c.json({ randNumber: Math.floor(Math.random() * 100) }));
			const honoResult = await runBenchmark("Hono Framework (Simple)", async (req) => honoApp.fetch(req), requests);

			// Elysia Framework
			const elysiaApp = new Elysia();
			elysiaApp.get("/", () => ({ randNumber: Math.floor(Math.random() * 100) }));
			const elysiaResult = await runBenchmark("Elysia Framework (Simple)", (req) => elysiaApp.handle(req), requests);

			/*
			console.log(`\nSimple Route Performance Comparison:`);
			console.log(`Web: ${webResult.rps.toLocaleString()} req/s`);
			console.log(`Hono: ${honoResult.rps.toLocaleString()} req/s`);
			console.log(`Elysia: ${elysiaResult.rps.toLocaleString()} req/s`);
			*/
		});
	});

	describe("Complex Routing Benchmark", () => {
		it("benchmarks complex routing scenarios", async () => {
			const requests = [
				mockRequest("/"),
				mockRequest("/users"),
				mockRequest("/users/123"),
				mockRequest("/users/456/posts"),
				mockRequest("/users/789/posts/abc"),
				mockRequest("/api/v1/health"),
				mockRequest("/api/v1/users/search"),
				mockRequest("/static/js/app.js"),
				mockRequest("/admin/dashboard"),
				mockRequest("/products/electronics/laptops"),
			];

			// Setup Web Framework
			const webApp = new Web();
			setupComplexRoutes(webApp);
			const webResult = await runBenchmark("Web Framework (Complex)", (req) => webApp.handle(req), requests);

			// Setup Hono Framework
			const honoApp = new Hono();
			setupComplexRoutes(honoApp);
			const honoResult = await runBenchmark("Hono Framework (Complex)", async (req) => honoApp.fetch(req), requests);

			// Setup Elysia Framework
			const elysiaApp = new Elysia();
			setupComplexRoutes(elysiaApp);
			const elysiaResult = await runBenchmark("Elysia Framework (Complex)", (req) => elysiaApp.handle(req), requests);

			/*
			console.log(`\nComplex Routing Performance Comparison:`);
			console.log(`Web: ${webResult.rps.toLocaleString()} req/s`);
			console.log(`Hono: ${honoResult.rps.toLocaleString()} req/s`);
			console.log(`Elysia: ${elysiaResult.rps.toLocaleString()} req/s`);
			*/
		});
	});

	describe("Middleware Benchmark", () => {
		it("benchmarks middleware performance", async () => {
			const requests = [mockRequest("/protected/resource"), mockRequest("/api/data"), mockRequest("/public/info")];

			// Setup Web Framework with middleware
			const webApp = new Web();
			setupMiddlewareRoutes(webApp);
			const webResult = await runBenchmark("Web Framework (Middleware)", (req) => webApp.handle(req), requests);

			// Setup Hono Framework with middleware
			const honoApp = new Hono();
			setupMiddlewareRoutes(honoApp);
			const honoResult = await runBenchmark("Hono Framework (Middleware)", async (req) => honoApp.fetch(req), requests);

			// Setup Elysia Framework with middleware
			const elysiaApp = new Elysia();
			setupMiddlewareRoutes(elysiaApp);
			const elysiaResult = await runBenchmark("Elysia Framework (Middleware)", (req) => elysiaApp.handle(req), requests);

			/*
			console.log(`\nMiddleware Performance Comparison:`);
			console.log(`Web: ${webResult.rps.toLocaleString()} req/s`);
			console.log(`Hono: ${honoResult.rps.toLocaleString()} req/s`);
			console.log(`Elysia: ${elysiaResult.rps.toLocaleString()} req/s`);
			*/
		});
	});

	describe("Parameter Extraction Benchmark", () => {
		it("benchmarks parameter extraction performance", async () => {
			const requests = [
				mockRequest("/users/user123"),
				mockRequest("/users/user456/posts/post789"),
				mockRequest("/products/category123/item456"),
				mockRequest("/api/v1/users/user789/profile"),
				mockRequest("/files/folder1/folder2/file.txt"),
			];

			// Setup Web Framework
			const webApp = new Web();
			setupParamRoutes(webApp);
			const webResult = await runBenchmark("Web Framework (Params)", (req) => webApp.handle(req), requests);

			// Setup Hono Framework
			const honoApp = new Hono();
			setupParamRoutes(honoApp);
			const honoResult = await runBenchmark("Hono Framework (Params)", async (req) => honoApp.fetch(req), requests);

			// Setup Elysia Framework
			const elysiaApp = new Elysia();
			setupParamRoutes(elysiaApp);
			const elysiaResult = await runBenchmark("Elysia Framework (Params)", (req) => elysiaApp.handle(req), requests);

			/*
			console.log(`\nParameter Extraction Performance Comparison:`);
			console.log(`Web: ${webResult.rps.toLocaleString()} req/s`);
			console.log(`Hono: ${honoResult.rps.toLocaleString()} req/s`);
			console.log(`Elysia: ${elysiaResult.rps.toLocaleString()} req/s`);
			*/
		});
	});

	describe("JSON Body Parsing Benchmark", () => {
		it("benchmarks JSON body parsing performance", async () => {
			const requests = [
				mockRequest("/api/users", "POST", { name: "John", email: "john@example.com" }),
				mockRequest("/api/products", "POST", { title: "Laptop", price: 999, category: "electronics" }),
				mockRequest("/api/orders", "POST", {
					userId: 123,
					items: [
						{ id: 1, qty: 2 },
						{ id: 2, qty: 1 },
					],
				}),
			];

			// Setup Web Framework
			const webApp = new Web();
			setupBodyParsingRoutes(webApp);
			const webResult = await runBenchmark("Web Framework (JSON Body)", (req) => webApp.handle(req), requests, 50_000);

			// Setup Hono Framework
			const honoApp = new Hono();
			setupBodyParsingRoutes(honoApp);
			const honoResult = await runBenchmark("Hono Framework (JSON Body)", async (req) => honoApp.fetch(req), requests, 50_000);

			// Setup Elysia Framework
			const elysiaApp = new Elysia();
			setupBodyParsingRoutes(elysiaApp);
			const elysiaResult = await runBenchmark("Elysia Framework (JSON Body)", (req) => elysiaApp.handle(req), requests, 50_000);

			/*
			console.log(`\nJSON Body Parsing Performance Comparison:`);
			console.log(`Web: ${webResult.rps.toLocaleString()} req/s`);
			console.log(`Hono: ${honoResult.rps.toLocaleString()} req/s`);
			console.log(`Elysia: ${elysiaResult.rps.toLocaleString()} req/s`);
			*/
		});
	});
});

// Helper functions to setup routes for different frameworks
function setupComplexRoutes(app: Web | Hono | Elysia) {
	if (app instanceof Web) {
		app.get("/", (ctx: any) => ctx.json({ message: "home" }));
		app.get("/users", (ctx: any) => ctx.json({ users: [] }));
		app.get("/users/:id", (ctx: any) => ctx.json({ user: { id: ctx.params.id } }));
		app.get("/users/:id/posts", (ctx: any) => ctx.json({ posts: [], userId: ctx.params.id }));
		app.get("/users/:id/posts/:postId", (ctx: any) => ctx.json({ post: { id: ctx.params.postId, userId: ctx.params.id } }));
		app.get("/api/v1/health", (ctx: any) => ctx.json({ status: "ok" }));
		app.get("/api/v1/users/search", (ctx: any) => ctx.json({ results: [] }));
		app.get("/static/js/app.js", (ctx: any) => ctx.text("console.log('app');"));
		app.get("/admin/dashboard", (ctx: any) => ctx.html("<h1>Dashboard</h1>"));
		app.get("/products/:category/:subcategory", (ctx: any) =>
			ctx.json({
				category: ctx.params.category,
				subcategory: ctx.params.subcategory,
			})
		);
	} else if (app instanceof Hono) {
		app.get("/", (c: any) => c.json({ message: "home" }));
		app.get("/users", (c: any) => c.json({ users: [] }));
		app.get("/users/:id", (c: any) => c.json({ user: { id: c.req.param("id") } }));
		app.get("/users/:id/posts", (c: any) => c.json({ posts: [], userId: c.req.param("id") }));
		app.get("/users/:id/posts/:postId", (c: any) => c.json({ post: { id: c.req.param("postId"), userId: c.req.param("id") } }));
		app.get("/api/v1/health", (c: any) => c.json({ status: "ok" }));
		app.get("/api/v1/users/search", (c: any) => c.json({ results: [] }));
		app.get("/static/js/app.js", (c: any) => c.text("console.log('app');"));
		app.get("/admin/dashboard", (c: any) => c.html("<h1>Dashboard</h1>"));
		app.get("/products/:category/:subcategory", (c: any) =>
			c.json({
				category: c.req.param("category"),
				subcategory: c.req.param("subcategory"),
			})
		);
	} else if (app instanceof Elysia) {
		app.get("/", () => ({ message: "home" }));
		app.get("/users", () => ({ users: [] }));
		app.get("/users/:id", ({ params }: any) => ({ user: { id: params.id } }));
		app.get("/users/:id/posts", ({ params }: any) => ({ posts: [], userId: params.id }));
		app.get("/users/:id/posts/:postId", ({ params }: any) => ({ post: { id: params.postId, userId: params.id } }));
		app.get("/api/v1/health", () => ({ status: "ok" }));
		app.get("/api/v1/users/search", () => ({ results: [] }));
		app.get("/static/js/app.js", () => new Response("console.log('app');", { headers: { "Content-Type": "text/plain" } }));
		app.get("/admin/dashboard", () => new Response("<h1>Dashboard</h1>", { headers: { "Content-Type": "text/html" } }));
		app.get("/products/:category/:subcategory", ({ params }: any) => ({
			category: params.category,
			subcategory: params.subcategory,
		}));
	}
}

function setupMiddlewareRoutes(app: Web | Hono | Elysia) {
	if (app instanceof Web) {
		// Global middleware
		app.use((ctx: any, next: any) => {
			ctx.set("requestId", Math.random().toString(36).substr(2, 9));
			return next();
		});

		// Path-specific middleware
		app.use("/protected/*", (ctx: any, next: any) => {
			ctx.set("authenticated", true);
			return next();
		});

		app.use("/api/*", (ctx: any, next: any) => {
			ctx.set("apiVersion", "v1");
			return next();
		});

		app.get("/protected/resource", (ctx: any) =>
			ctx.json({
				data: "protected",
				requestId: ctx.get("requestId"),
				authenticated: ctx.get("authenticated"),
			})
		);
		app.get("/api/data", (ctx: any) =>
			ctx.json({
				data: "api",
				requestId: ctx.get("requestId"),
				version: ctx.get("apiVersion"),
			})
		);
		app.get("/public/info", (ctx: any) =>
			ctx.json({
				data: "public",
				requestId: ctx.get("requestId"),
			})
		);
	} else if (app instanceof Hono) {
		// Global middleware
		app.use("*", (c: any, next: any) => {
			c.set("requestId", Math.random().toString(36).substr(2, 9));
			return next();
		});

		// Path-specific middleware
		app.use("/protected/*", (c: any, next: any) => {
			c.set("authenticated", true);
			return next();
		});

		app.use("/api/*", (c: any, next: any) => {
			c.set("apiVersion", "v1");
			return next();
		});

		app.get("/protected/resource", (c: any) =>
			c.json({
				data: "protected",
				requestId: c.get("requestId"),
				authenticated: c.get("authenticated"),
			})
		);
		app.get("/api/data", (c: any) =>
			c.json({
				data: "api",
				requestId: c.get("requestId"),
				version: c.get("apiVersion"),
			})
		);
		app.get("/public/info", (c: any) =>
			c.json({
				data: "public",
				requestId: c.get("requestId"),
			})
		);
	} else if (app instanceof Elysia) {
		// Global middleware
		app.onRequest(({ set }) => {
			set.headers = { "x-request-id": Math.random().toString(36).substr(2, 9) };
		});

		app.get("/protected/resource", () => ({
			data: "protected",
			authenticated: true,
		}));
		app.get("/api/data", () => ({
			data: "api",
			version: "v1",
		}));
		app.get("/public/info", () => ({
			data: "public",
		}));
	}
}

function setupParamRoutes(app: Web | Hono | Elysia) {
	if (app instanceof Web) {
		app.get("/users/:userId", (ctx) => ctx.json({ userId: ctx.params.userId }));
		app.get("/users/:userId/posts/:postId", (ctx) =>
			ctx.json({
				userId: ctx.params.userId,
				postId: ctx.params.postId,
			})
		);
		app.get("/products/:categoryId/item/:itemId", (ctx) =>
			ctx.json({
				categoryId: ctx.params.categoryId,
				itemId: ctx.params.itemId,
			})
		);
		app.get("/api/v1/users/:userId/profile", (ctx) =>
			ctx.json({
				userId: ctx.params.userId,
				profile: {},
			})
		);
		app.get("/files/*", (ctx) => ctx.json({ path: ctx.params["*"] }));
	} else if (app instanceof Hono) {
		app.get("/users/:userId", (c) => c.json({ userId: c.req.param("userId") }));
		app.get("/users/:userId/posts/:postId", (c) =>
			c.json({
				userId: c.req.param("userId"),
				postId: c.req.param("postId"),
			})
		);
		app.get("/products/:categoryId/item/:itemId", (c) =>
			c.json({
				categoryId: c.req.param("categoryId"),
				itemId: c.req.param("itemId"),
			})
		);
		app.get("/api/v1/users/:userId/profile", (c) =>
			c.json({
				userId: c.req.param("userId"),
				profile: {},
			})
		);
		app.get("/files/*", (c) => c.json({ path: c.req.param("*") }));
	} else if (app instanceof Elysia) {
		app.get("/users/:userId", ({ params }: any) => ({ userId: params.userId }));
		app.get("/users/:userId/posts/:postId", ({ params }: any) => ({
			userId: params.userId,
			postId: params.postId,
		}));
		app.get("/products/:categoryId/item/:itemId", ({ params }: any) => ({
			categoryId: params.categoryId,
			itemId: params.itemId,
		}));
		app.get("/api/v1/users/:userId/profile", ({ params }: any) => ({
			userId: params.userId,
			profile: {},
		}));
		app.get("/files/*", ({ params }: any) => ({ path: params["*"] }));
	}
}

function setupBodyParsingRoutes(app: Web | Hono | Elysia) {
	if (app instanceof Web) {
		app.post("/api/users", async (ctx) => {
			const body = await ctx.body();
			return ctx.json({ created: body, id: Math.random() });
		});
		app.post("/api/products", async (ctx) => {
			const body = await ctx.body();
			return ctx.json({ created: body, id: Math.random() });
		});
		app.post("/api/orders", async (ctx) => {
			const body = await ctx.body();
			return ctx.json({ created: body, id: Math.random() });
		});
	} else if (app instanceof Hono) {
		app.post("/api/users", async (c) => {
			const body = await c.req.json();
			return c.json({ created: body, id: Math.random() });
		});
		app.post("/api/products", async (c) => {
			const body = await c.req.json();
			return c.json({ created: body, id: Math.random() });
		});
		app.post("/api/orders", async (c) => {
			const body = await c.req.json();
			return c.json({ created: body, id: Math.random() });
		});
	} else if (app instanceof Elysia) {
		app.post("/api/users", ({ body }: any) => ({ created: body, id: Math.random() }));
		app.post("/api/products", ({ body }: any) => ({ created: body, id: Math.random() }));
		app.post("/api/orders", ({ body }: any) => ({ created: body, id: Math.random() }));
	}
}
