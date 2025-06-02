import { describe, it, expect, beforeEach } from "bun:test";
import { Web } from "../../packages/core/src";
import { cors } from "../../packages/middleware/src/cors";

describe("CORS Middleware", () => {
	let app: Web;

	beforeEach(() => {
		app = new Web();
	});

	it("should set wildcard origin when no origin specified", async () => {
		app.use(cors());
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/");
		const res = await app.handle(req);

		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	it("should set specific origin when provided", async () => {
		app.use(cors({ origin: "https://example.com" }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { Origin: "https://example.com" },
		});
		const res = await app.handle(req);

		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
	});

	it("should not set origin header for disallowed origin", async () => {
		app.use(cors({ origin: "https://example.com" }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { Origin: "https://evil.com" },
		});
		const res = await app.handle(req);

		expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("should handle array of allowed origins", async () => {
		app.use(
			cors({
				origin: ["https://example.com", "https://app.example.com"],
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req1 = new Request("http://localhost/", {
			headers: { Origin: "https://example.com" },
		});
		const res1 = await app.handle(req1);
		expect(res1.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");

		const req2 = new Request("http://localhost/", {
			headers: { Origin: "https://app.example.com" },
		});
		const res2 = await app.handle(req2);
		expect(res2.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
	});

	it("should handle function-based origin validation", async () => {
		app.use(
			cors({
				origin: (origin) => origin.endsWith(".example.com"),
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { Origin: "https://sub.example.com" },
		});
		const res = await app.handle(req);

		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://sub.example.com");
	});

	it("should handle async function-based origin validation", async () => {
		app.use(
			cors({
				origin: async (origin) => {
					// Simulate async check (e.g., database lookup)
					await new Promise((resolve) => setTimeout(resolve, 10));
					return origin === "https://allowed.com";
				},
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			headers: { Origin: "https://allowed.com" },
		});
		const res = await app.handle(req);

		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://allowed.com");
	});

	it("should set credentials header when enabled", async () => {
		app.use(cors({ credentials: true }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/");
		const res = await app.handle(req);

		expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
	});

	it("should set exposed headers", async () => {
		app.use(
			cors({
				exposeHeaders: ["X-Custom-Header", "X-Another-Header"],
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/");
		const res = await app.handle(req);

		expect(res.headers.get("Access-Control-Expose-Headers")).toBe("X-Custom-Header, X-Another-Header");
	});

	it("should handle preflight OPTIONS request", async () => {
		app.use(
			cors({
				allowMethods: ["GET", "POST", "PUT"],
				allowHeaders: ["Content-Type", "Authorization"],
				maxAge: 3600,
			})
		);
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			method: "OPTIONS",
			headers: { Origin: "https://example.com" },
		});
		const res = await app.handle(req);

		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PUT");
		expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
		expect(res.headers.get("Access-Control-Max-Age")).toBe("3600");
	});

	it("should continue to next middleware when preflightContinue is true", async () => {
		let optionsHandlerCalled = false;

		app.use(cors({ preflightContinue: true }));
		app.options("/", (ctx) => {
			optionsHandlerCalled = true;
			return ctx.text("Custom OPTIONS handler");
		});

		const req = new Request("http://localhost/", {
			method: "OPTIONS",
		});
		const res = await app.handle(req);

		expect(optionsHandlerCalled).toBe(true);
		expect(await res.text()).toBe("Custom OPTIONS handler");
	});

	it("should use custom success status for OPTIONS", async () => {
		app.use(cors({ optionsSuccessStatus: 200 }));
		app.get("/", (ctx) => ctx.text("OK"));

		const req = new Request("http://localhost/", {
			method: "OPTIONS",
		});
		const res = await app.handle(req);

		expect(res.status).toBe(200);
	});
});
