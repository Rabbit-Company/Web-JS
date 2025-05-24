import { describe, it } from "bun:test";
import { Web } from "../src/index";
import { Hono } from "hono";
import { Elysia } from "elysia";

function mockRequest(path: string, method = "GET") {
	return new Request(`http://localhost${path}`, { method });
}

async function runBenchmark(name: string, handler: (req: Request) => Promise<Response>, iterations = 1_000_000) {
	const start = performance.now();

	for (let i = 0; i < iterations; i++) {
		const res = await handler(mockRequest("/"));
		// Consume response body to avoid lazy evaluation effects
		await res.json();
	}

	const end = performance.now();
	console.log(`${name} took ${(end - start).toFixed(2)} ms for ${iterations} requests`);
}

describe("Benchmark Web vs Hono", () => {
	it("benchmarks Web framework", async () => {
		const app = new Web();
		app.get("/", (ctx) => ctx.json({ randNumber: Math.floor(Math.random() * 100) }));

		await runBenchmark("Web Framework", (req) => app.handle(req));
	});

	it("benchmarks Hono framework", async () => {
		const app = new Hono();
		app.get("/", (c) => c.json({ randNumber: Math.floor(Math.random() * 100) }));

		await runBenchmark("Hono Framework", async (req) => app.fetch(req));
	});

	it("benchmarks Elysia framework", async () => {
		const app = new Elysia();
		app.get("/", () => {
			return { randNumber: Math.floor(Math.random() * 100) };
		});

		await runBenchmark("Elysia Framework", async (req) => app.handle(req));
	});
});
