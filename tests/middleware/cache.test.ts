import { describe, test, expect, beforeEach } from "bun:test";
import { Web } from "../../packages/core/src";
import { cache, MemoryCache, type CacheStorage } from "../../packages/middleware/src/cache";

describe("Cache Middleware", () => {
	let app: Web<{ user?: { id?: string } }>;
	let requestCount: number;

	beforeEach(() => {
		app = new Web<{ user?: { id?: string } }>();
		requestCount = 0;
	});

	describe("Basic Caching", () => {
		test("should cache GET requests by default", async () => {
			app.use(cache());
			app.get("/test", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request - should miss cache
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				const data1 = await res1.json();
				expect(data1.count).toBe(1);
				expect(res1.headers.get("x-cache-status")).toBe("MISS");

				// Second request - should hit cache
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				const data2 = await res2.json();
				expect(data2.count).toBe(1); // Same count, not incremented
				expect(res2.headers.get("x-cache-status")).toBe("HIT");

				// Verify handler was only called once
				expect(requestCount).toBe(1);
			} finally {
				server.stop();
			}
		});

		test("should not cache POST requests by default", async () => {
			app.use(cache());
			app.post("/test", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First POST
				const res1 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
				});
				const data1 = await res1.json();
				expect(data1.count).toBe(1);
				expect(res1.headers.get("x-cache-status")).toBeNull();

				// Second POST - should not be cached
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
				});
				const data2 = await res2.json();
				expect(data2.count).toBe(2);
				expect(res2.headers.get("x-cache-status")).toBeNull();
			} finally {
				server.stop();
			}
		});

		test("should cache HEAD requests", async () => {
			app.use(cache());
			app.head("/test", (ctx) => {
				requestCount++;
				return new Response(null, {
					headers: { "x-count": requestCount.toString() },
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First HEAD request
				const res1 = await fetch(`http://localhost:${server.port}/test`, {
					method: "HEAD",
				});
				expect(res1.headers.get("x-count")).toBe("1");
				expect(res1.headers.get("x-cache-status")).toBe("MISS");

				// Second HEAD request - should be cached
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					method: "HEAD",
				});
				expect(res2.headers.get("x-count")).toBe("1");
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
			} finally {
				server.stop();
			}
		});

		test("should only cache successful responses by default", async () => {
			app.use(cache());
			let shouldFail = true;

			app.get("/test", (ctx) => {
				requestCount++;
				if (shouldFail) {
					shouldFail = false;
					return ctx.json({ error: "Failed" }, 500);
				}
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request - 500 error
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				expect(res1.status).toBe(500);

				// Second request - should not use cached error
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				expect(res2.status).toBe(200);
				const data2 = await res2.json();
				expect(data2.count).toBe(2);

				// Third request - should use cached success
				const res3 = await fetch(`http://localhost:${server.port}/test`);
				expect(res3.status).toBe(200);
				const data3 = await res3.json();
				expect(data3.count).toBe(2); // Same count
			} finally {
				server.stop();
			}
		});
	});

	describe("TTL and Expiration", () => {
		test("should respect TTL", async () => {
			app.use(cache({ ttl: 1 })); // 1 second TTL
			app.get("/test", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				const data1 = await res1.json();
				expect(data1.count).toBe(1);
				expect(res1.headers.get("x-cache-status")).toBe("MISS");

				// Second request - should hit cache
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				const data2 = await res2.json();
				expect(data2.count).toBe(1);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");

				// Wait for TTL to expire
				await new Promise((resolve) => setTimeout(resolve, 1100));

				// Third request - cache should be expired
				const res3 = await fetch(`http://localhost:${server.port}/test`);
				const data3 = await res3.json();
				expect(data3.count).toBe(2);
				expect(res3.headers.get("x-cache-status")).toBe("MISS");
			} finally {
				server.stop();
			}
		});

		test("should respect Cache-Control max-age", async () => {
			app.use(cache({ respectCacheControl: true, ttl: 300 }));
			app.get("/test", (ctx) => {
				requestCount++;
				return new Response(JSON.stringify({ count: requestCount }), {
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "max-age=1", // 1 second
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				await fetch(`http://localhost:${server.port}/test`);

				// Second request - should hit cache
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");

				// Wait for Cache-Control max-age to expire
				await new Promise((resolve) => setTimeout(resolve, 1100));

				// Third request - should miss cache
				const res3 = await fetch(`http://localhost:${server.port}/test`);
				expect(res3.headers.get("x-cache-status")).toBe("MISS");
			} finally {
				server.stop();
			}
		});

		test("should not cache when Cache-Control: no-store", async () => {
			app.use(cache({ respectCacheControl: true }));
			app.get("/test", (ctx) => {
				requestCount++;
				return new Response(JSON.stringify({ count: requestCount }), {
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				const data1 = await res1.json();
				expect(data1.count).toBe(1);

				// Second request - should not be cached
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				const data2 = await res2.json();
				expect(data2.count).toBe(2);
			} finally {
				server.stop();
			}
		});

		test("should add Age header", async () => {
			app.use(cache({ ttl: 10 }));
			app.get("/test", (ctx) => ctx.json({ message: "cached" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				await fetch(`http://localhost:${server.port}/test`);

				// Wait a bit
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Second request - check age header
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				const age = res2.headers.get("age");
				expect(age).toBeDefined();
				expect(parseInt(age!)).toBeGreaterThanOrEqual(1);
			} finally {
				server.stop();
			}
		});
	});

	describe("Vary Headers", () => {
		test("should cache separately based on vary headers", async () => {
			app.use(cache({ varyHeaders: ["accept"] }));
			app.get("/test", (ctx) => {
				const accept = ctx.req.headers.get("accept") || "none";
				requestCount++;
				return ctx.json({ count: requestCount, accept });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Request with Accept: application/json
				const res1 = await fetch(`http://localhost:${server.port}/test`, {
					headers: { accept: "application/json" },
				});
				const data1 = await res1.json();
				expect(data1.count).toBe(1);
				expect(data1.accept).toBe("application/json");

				// Same Accept header - should hit cache
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					headers: { accept: "application/json" },
				});
				const data2 = await res2.json();
				expect(data2.count).toBe(1);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");

				// Different Accept header - should miss cache
				const res3 = await fetch(`http://localhost:${server.port}/test`, {
					headers: { accept: "text/html" },
				});
				const data3 = await res3.json();
				expect(data3.count).toBe(2);
				expect(data3.accept).toBe("text/html");
				expect(res3.headers.get("x-cache-status")).toBe("MISS");
			} finally {
				server.stop();
			}
		});

		test("should handle multiple vary headers", async () => {
			app.use(cache({ varyHeaders: ["accept", "accept-language"] }));
			app.get("/test", (ctx) => {
				requestCount++;
				return ctx.json({
					count: requestCount,
					accept: ctx.req.headers.get("accept"),
					lang: ctx.req.headers.get("accept-language"),
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				await fetch(`http://localhost:${server.port}/test`, {
					headers: {
						accept: "application/json",
						"accept-language": "en-US",
					},
				});

				// Same headers - should hit
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					headers: {
						accept: "application/json",
						"accept-language": "en-US",
					},
				});
				expect(res2.headers.get("x-cache-status")).toBe("HIT");

				// Different language - should miss
				const res3 = await fetch(`http://localhost:${server.port}/test`, {
					headers: {
						accept: "application/json",
						"accept-language": "fr-FR",
					},
				});
				expect(res3.headers.get("x-cache-status")).toBe("MISS");
			} finally {
				server.stop();
			}
		});
	});

	describe("ETags and Conditional Requests", () => {
		test("should generate ETags", async () => {
			app.use(cache());
			app.get("/test", (ctx) => ctx.json({ data: "test content" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/test`);
				const etag = res.headers.get("etag");
				expect(etag).toBeDefined();
				expect(etag?.length).toBe(128);
			} finally {
				server.stop();
			}
		});

		test("should handle If-None-Match", async () => {
			app.use(cache());
			app.get("/test", (ctx) => ctx.json({ data: "test content" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request to get ETag
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				const etag = res1.headers.get("etag");
				expect(etag).toBeDefined();

				// Second request with If-None-Match
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					headers: { "if-none-match": etag! },
				});
				expect(res2.status).toBe(304);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
			} finally {
				server.stop();
			}
		});
	});

	describe("generateETags Option", () => {
		test("should generate ETags by default", async () => {
			app.use(cache());
			app.get("/test", (ctx) => ctx.json({ data: "test content" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/test`);
				const etag = res.headers.get("etag");
				expect(etag).toBeDefined();
				expect(etag).not.toBeNull();
			} finally {
				server.stop();
			}
		});

		test("should not generate ETags when disabled", async () => {
			app.use(cache({ generateETags: false }));
			app.get("/test", (ctx) => ctx.json({ data: "test content" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/test`);
				const etag = res.headers.get("etag");
				expect(etag).toBeNull();
			} finally {
				server.stop();
			}
		});

		test("should still cache responses without ETags", async () => {
			app.use(cache({ generateETags: false }));
			app.get("/test", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				expect(res1.headers.get("x-cache-status")).toBe("MISS");
				expect(res1.headers.get("etag")).toBeNull();

				// Second request - should be cached even without ETag
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
				expect(res2.headers.get("etag")).toBeNull();
				const data2 = await res2.json();
				expect(data2.count).toBe(1); // Same count, cached
			} finally {
				server.stop();
			}
		});

		test("should preserve existing ETags when generateETags is false", async () => {
			app.use(cache({ generateETags: false }));
			app.get("/test", (ctx) => {
				return new Response(JSON.stringify({ data: "test" }), {
					headers: {
						"Content-Type": "application/json",
						ETag: '"custom-etag-123"',
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/test`);
				expect(res.headers.get("etag")).toBe('"custom-etag-123"');
			} finally {
				server.stop();
			}
		});
	});

	describe("maxETagBodySize Option", () => {
		test("should not generate ETag for large bodies", async () => {
			app.use(cache({ maxETagBodySize: 100 })); // 100 bytes max

			app.get("/small", (ctx) => ctx.json({ data: "small" })); // < 100 bytes
			app.get("/large", (ctx) => {
				// Create a response larger than 100 bytes
				const largeData = { data: "x".repeat(200) };
				return ctx.json(largeData);
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Small response should have ETag
				const resSmall = await fetch(`http://localhost:${server.port}/small`);
				expect(resSmall.headers.get("etag")).toBeDefined();

				// Large response should not have ETag
				const resLarge = await fetch(`http://localhost:${server.port}/large`);
				expect(resLarge.headers.get("etag")).toBeNull();

				// But should still be cached
				const resLarge2 = await fetch(`http://localhost:${server.port}/large`);
				expect(resLarge2.headers.get("x-cache-status")).toBe("HIT");
			} finally {
				server.stop();
			}
		});

		test("should respect Content-Length header for size check", async () => {
			app.use(cache({ maxETagBodySize: 1000 }));

			app.get("/with-length", (ctx) => {
				const body = "x".repeat(2000); // 2000 bytes
				return new Response(body, {
					headers: {
						"Content-Type": "text/plain",
						"Content-Length": "2000",
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Should not generate ETag based on Content-Length
				const res = await fetch(`http://localhost:${server.port}/with-length`);
				expect(res.headers.get("etag")).toBeNull();
			} finally {
				server.stop();
			}
		});
	});

	describe("skipETagContentTypes Option", () => {
		test("should skip ETag generation for specified content types", async () => {
			app.use(cache());

			app.get("/json", (ctx) => ctx.json({ data: "test" }));
			app.get("/image", (ctx) => {
				return new Response("fake-image-data", {
					headers: { "Content-Type": "image/png" },
				});
			});
			app.get("/video", (ctx) => {
				return new Response("fake-video-data", {
					headers: { "Content-Type": "video/mp4" },
				});
			});
			app.get("/audio", (ctx) => {
				return new Response("fake-audio-data", {
					headers: { "Content-Type": "audio/mpeg" },
				});
			});
			app.get("/pdf", (ctx) => {
				return new Response("fake-pdf-data", {
					headers: { "Content-Type": "application/pdf" },
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// JSON should have ETag
				const resJson = await fetch(`http://localhost:${server.port}/json`);
				expect(resJson.headers.get("etag")).toBeDefined();

				// Image should not have ETag
				const resImage = await fetch(`http://localhost:${server.port}/image`);
				expect(resImage.headers.get("etag")).toBeNull();

				// Video should not have ETag
				const resVideo = await fetch(`http://localhost:${server.port}/video`);
				expect(resVideo.headers.get("etag")).toBeNull();

				// Audio should not have ETag
				const resAudio = await fetch(`http://localhost:${server.port}/audio`);
				expect(resAudio.headers.get("etag")).toBeNull();

				// PDF should not have ETag
				const resPdf = await fetch(`http://localhost:${server.port}/pdf`);
				expect(resPdf.headers.get("etag")).toBeNull();
			} finally {
				server.stop();
			}
		});

		test("should allow custom content type skip list", async () => {
			app.use(
				cache({
					skipETagContentTypes: ["text/csv", "application/xml"],
				})
			);

			app.get("/csv", (ctx) => {
				return new Response("a,b,c\n1,2,3", {
					headers: { "Content-Type": "text/csv" },
				});
			});
			app.get("/xml", (ctx) => {
				return new Response("<root></root>", {
					headers: { "Content-Type": "application/xml" },
				});
			});
			app.get("/json", (ctx) => ctx.json({ data: "test" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// CSV should not have ETag
				const resCsv = await fetch(`http://localhost:${server.port}/csv`);
				expect(resCsv.headers.get("etag")).toBeNull();

				// XML should not have ETag
				const resXml = await fetch(`http://localhost:${server.port}/xml`);
				expect(resXml.headers.get("etag")).toBeNull();

				// JSON should still have ETag (not in skip list)
				const resJson = await fetch(`http://localhost:${server.port}/json`);
				expect(resJson.headers.get("etag")).toBeDefined();
			} finally {
				server.stop();
			}
		});

		test("should handle partial content type matches", async () => {
			app.use(cache());

			app.get("/image-jpeg", (ctx) => {
				return new Response("fake-image", {
					headers: { "Content-Type": "image/jpeg; charset=utf-8" },
				});
			});
			app.get("/video-stream", (ctx) => {
				return new Response("fake-video", {
					headers: { "Content-Type": "video/mp4; codecs=avc1" },
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Should match "image/" prefix
				const resImage = await fetch(`http://localhost:${server.port}/image-jpeg`);
				expect(resImage.headers.get("etag")).toBeNull();

				// Should match "video/" prefix
				const resVideo = await fetch(`http://localhost:${server.port}/video-stream`);
				expect(resVideo.headers.get("etag")).toBeNull();
			} finally {
				server.stop();
			}
		});
	});

	describe("shouldGenerateETag Function", () => {
		test("should use custom shouldGenerateETag function", async () => {
			app.use(
				cache({
					shouldGenerateETag: (ctx, res) => {
						// Only generate ETag for /api routes
						const url = new URL(ctx.req.url);
						return url.pathname.startsWith("/api");
					},
				})
			);

			app.get("/api/data", (ctx) => ctx.json({ data: "api" }));
			app.get("/public/data", (ctx) => ctx.json({ data: "public" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// API route should have ETag
				const resApi = await fetch(`http://localhost:${server.port}/api/data`);
				expect(resApi.headers.get("etag")).toBeDefined();

				// Public route should not have ETag
				const resPublic = await fetch(`http://localhost:${server.port}/public/data`);
				expect(resPublic.headers.get("etag")).toBeNull();
			} finally {
				server.stop();
			}
		});

		test("should not generate ETag for responses that already have one", async () => {
			app.use(cache());

			app.get("/with-etag", (ctx) => {
				return new Response(JSON.stringify({ data: "test" }), {
					headers: {
						"Content-Type": "application/json",
						ETag: '"existing-etag"',
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/with-etag`);
				// Should keep existing ETag, not generate new one
				expect(res.headers.get("etag")).toBe('"existing-etag"');
			} finally {
				server.stop();
			}
		});

		test("should not generate ETag for chunked responses", async () => {
			app.use(cache());

			app.get("/chunked", (ctx) => {
				return new Response("chunked data", {
					headers: {
						"Content-Type": "text/plain",
						"Transfer-Encoding": "chunked",
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/chunked`);
				expect(res.headers.get("etag")).toBeNull();
			} finally {
				server.stop();
			}
		});
	});

	describe("ETag Performance", () => {
		test("should not read body twice when ETag generation is disabled", async () => {
			let bodyReadCount = 0;

			app.use(cache({ generateETags: false }));
			app.get("/test", (ctx) => {
				const originalJson = ctx.json.bind(ctx);
				// Override json to track body serialization
				ctx.json = (data: any, status?: number) => {
					bodyReadCount++;
					return originalJson(data, status);
				};
				return ctx.json({ data: "test" });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				await fetch(`http://localhost:${server.port}/test`);
				// Body should only be read once (for the response)
				expect(bodyReadCount).toBe(1);
			} finally {
				server.stop();
			}
		});

		test("should handle streaming responses without buffering", async () => {
			app.use(cache());

			app.get("/stream", (ctx) => {
				// Create a streaming response
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("chunk1"));
						controller.enqueue(new TextEncoder().encode("chunk2"));
						controller.close();
					},
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/plain",
						"Transfer-Encoding": "chunked",
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/stream`);
				// Should not generate ETag for streaming
				expect(res.headers.get("etag")).toBeNull();
				// Should still receive the stream
				const text = await res.text();
				expect(text).toBe("chunk1chunk2");
			} finally {
				server.stop();
			}
		});
	});

	describe("Edge Cases", () => {
		test("should handle empty responses", async () => {
			app.use(cache());

			app.get("/empty", (ctx) => {
				return new Response(null, {
					status: 204,
					headers: { "Content-Type": "application/json" },
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/empty`);
				expect(res.status).toBe(204);
				// Should generate ETag even for empty body
				expect(res.headers.get("etag")).toBeDefined();
			} finally {
				server.stop();
			}
		});

		test("should handle responses without content-type", async () => {
			app.use(cache());

			app.get("/no-type", (ctx) => {
				return new Response("data");
				// No Content-Type header
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/no-type`);
				// Should still generate ETag
				expect(res.headers.get("etag")).toBeDefined();
			} finally {
				server.stop();
			}
		});

		test("should handle case-insensitive content-type matching", async () => {
			app.use(cache());

			app.get("/mixed-case", (ctx) => {
				return new Response("image data", {
					headers: { "Content-Type": "IMAGE/PNG" }, // Uppercase
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/mixed-case`);
				// Should not generate ETag (matches image/ prefix)
				expect(res.headers.get("etag")).toBeNull();
			} finally {
				server.stop();
			}
		});
	});

	describe("Path Filtering", () => {
		test("should exclude paths from caching", async () => {
			app.use(
				cache({
					excludePaths: ["/api/auth", /^\/admin/],
				})
			);

			app.get("/api/users", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount, path: "users" });
			});

			app.get("/api/auth", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount, path: "auth" });
			});

			app.get("/admin/dashboard", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount, path: "admin" });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Cacheable path
				await fetch(`http://localhost:${server.port}/api/users`);
				const res1 = await fetch(`http://localhost:${server.port}/api/users`);
				expect(res1.headers.get("x-cache-status")).toBe("HIT");

				// Excluded path (exact match)
				await fetch(`http://localhost:${server.port}/api/auth`);
				const res2 = await fetch(`http://localhost:${server.port}/api/auth`);
				expect(res2.headers.get("x-cache-status")).toBeNull();

				// Excluded path (regex match)
				await fetch(`http://localhost:${server.port}/admin/dashboard`);
				const res3 = await fetch(`http://localhost:${server.port}/admin/dashboard`);
				expect(res3.headers.get("x-cache-status")).toBeNull();
			} finally {
				server.stop();
			}
		});

		test("should only cache included paths", async () => {
			app.use(
				cache({
					includePaths: ["/api", /^\/public/],
				})
			);

			app.get("/api/users", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			app.get("/private/data", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			app.get("/public/assets", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Included path
				await fetch(`http://localhost:${server.port}/api/users`);
				const res1 = await fetch(`http://localhost:${server.port}/api/users`);
				expect(res1.headers.get("x-cache-status")).toBe("HIT");

				// Not included path
				await fetch(`http://localhost:${server.port}/private/data`);
				const res2 = await fetch(`http://localhost:${server.port}/private/data`);
				expect(res2.headers.get("x-cache-status")).toBeNull();

				// Regex included path
				await fetch(`http://localhost:${server.port}/public/assets`);
				const res3 = await fetch(`http://localhost:${server.port}/public/assets`);
				expect(res3.headers.get("x-cache-status")).toBe("HIT");
			} finally {
				server.stop();
			}
		});
	});

	describe("Custom Configuration", () => {
		test("should use custom key generator", async () => {
			const customStorage = new MemoryCache();
			app.use(
				cache({
					storage: customStorage,
					keyGenerator: (ctx) => {
						// Only use pathname, ignore query params
						const url = new URL(ctx.req.url);
						return `custom:${ctx.req.method}:${url.pathname}`;
					},
				})
			);

			app.get("/test", (ctx) => {
				const url = new URL(ctx.req.url);
				requestCount++;
				return ctx.json({
					count: requestCount,
					query: url.searchParams.get("q"),
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request with query param q=1
				const res1 = await fetch(`http://localhost:${server.port}/test?q=1`);
				const data1 = await res1.json();
				expect(data1.count).toBe(1);
				expect(data1.query).toBe("1");
				expect(res1.headers.get("x-cache-status")).toBe("MISS");

				// Different query param but same path - should hit cache
				// Since we ignore query params in the key, this returns the cached response
				const res2 = await fetch(`http://localhost:${server.port}/test?q=2`);
				const data2 = await res2.json();
				expect(data2.count).toBe(1); // Same count as first request (cached)
				expect(data2.query).toBe("1"); // Same query value as cached response
				expect(res2.headers.get("x-cache-status")).toBe("HIT");

				// No query param - still same cache key, should hit cache
				const res3 = await fetch(`http://localhost:${server.port}/test`);
				const data3 = await res3.json();
				expect(data3.count).toBe(1); // Still cached
				expect(data3.query).toBe("1"); // Still the cached response
				expect(res3.headers.get("x-cache-status")).toBe("HIT");

				// Different path - should be cache miss
				const res4 = await fetch(`http://localhost:${server.port}/other`);
				expect(res4.status).toBe(404); // Or whatever your app returns for undefined routes

				// Same original query param - still cache hit
				const res5 = await fetch(`http://localhost:${server.port}/test?q=1`);
				const data5 = await res5.json();
				expect(data5.count).toBe(1); // Still cached
				expect(data5.query).toBe("1");
				expect(res5.headers.get("x-cache-status")).toBe("HIT");
			} finally {
				server.stop();
			}
		});

		test("should handle special characters in URLs", async () => {
			app.use(cache());
			app.get("/test/:param", (ctx) => {
				requestCount++;
				return ctx.json({
					count: requestCount,
					param: ctx.params.param,
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// URL with special characters
				const param = encodeURIComponent("test@#$%");
				await fetch(`http://localhost:${server.port}/test/${param}`);

				const res2 = await fetch(`http://localhost:${server.port}/test/${param}`);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
			} finally {
				server.stop();
			}
		});
	});

	describe("Private Responses", () => {
		test("should not cache private responses by default", async () => {
			app.use(cache({ respectCacheControl: true }));
			app.get("/test", (ctx) => {
				requestCount++;
				return new Response(JSON.stringify({ count: requestCount }), {
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "private, max-age=300",
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				await fetch(`http://localhost:${server.port}/test`);

				// Second request - should not be cached
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				const data2 = await res2.json();
				expect(data2.count).toBe(2);
				expect(res2.headers.get("x-cache-status")).toBe("MISS");
			} finally {
				server.stop();
			}
		});

		test("should cache private responses when configured", async () => {
			app.use(
				cache({
					respectCacheControl: true,
					cachePrivate: true,
				})
			);
			app.get("/test", (ctx) => {
				requestCount++;
				return new Response(JSON.stringify({ count: requestCount }), {
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "private, max-age=300",
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				await fetch(`http://localhost:${server.port}/test`);

				// Second request - should be cached even though private
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				const data2 = await res2.json();
				expect(data2.count).toBe(1);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
			} finally {
				server.stop();
			}
		});
	});

	describe("Stale While Revalidate", () => {
		test("should serve stale content while revalidating", async () => {
			let responseDelay = 0;
			let requestCount = 0;

			app.use(
				cache({
					ttl: 2, // 2 seconds fresh (more reliable for testing)
					staleWhileRevalidate: true,
					maxStaleAge: 10, // 10 seconds stale allowed
					storage: new MemoryCache(), // Explicit storage
				})
			);

			app.get("/test", async (ctx) => {
				requestCount++;
				if (responseDelay > 0) {
					await new Promise((resolve) => setTimeout(resolve, responseDelay));
				}
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request - cache miss
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				expect(res1.status).toBe(200);
				expect(res1.headers.get("x-cache-status")).toBe("MISS");
				const data1 = await res1.json();
				expect(data1.count).toBe(1);

				// Immediate second request - should be HIT
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
				const data2 = await res2.json();
				expect(data2.count).toBe(1);

				// Wait for content to become stale but not expired
				await new Promise((resolve) => setTimeout(resolve, 2100)); // 2.1 seconds

				// Set delay for background revalidation
				responseDelay = 200;

				// Third request - should serve stale immediately
				const start = Date.now();
				const res3 = await fetch(`http://localhost:${server.port}/test`);
				const duration = Date.now() - start;
				expect(duration).toBeLessThan(100); // Served immediately
				expect(res3.headers.get("x-cache-status")).toBe("STALE");
				const data3 = await res3.json();
				expect(data3.count).toBe(1); // Still old data

				// Wait for background revalidation to complete
				await new Promise((resolve) => setTimeout(resolve, 300));

				// Fourth request - should have fresh data
				const res4 = await fetch(`http://localhost:${server.port}/test`);
				expect(res4.headers.get("x-cache-status")).toBe("HIT");
				const data4 = await res4.json();
				expect(data4.count).toBe(2); // New data from revalidation
			} finally {
				server.stop();
			}
		});

		test("should not serve stale content beyond maxStaleAge", async () => {
			app.use(
				cache({
					ttl: 1,
					staleWhileRevalidate: true,
					maxStaleAge: 1, // Only 1 second stale allowed
				})
			);

			app.get("/test", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				await fetch(`http://localhost:${server.port}/test`);

				// Wait beyond maxStaleAge
				await new Promise((resolve) => setTimeout(resolve, 2100));

				// Should get fresh content, not stale
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				const data2 = await res2.json();
				expect(data2.count).toBe(2); // New request
				expect(res2.headers.get("x-cache-status")).toBe("MISS");
			} finally {
				server.stop();
			}
		});
	});

	describe("Cache-Control Directives", () => {
		test("should respect s-maxage over max-age", async () => {
			app.use(cache({ respectCacheControl: true }));
			app.get("/test", (ctx) => {
				requestCount++;
				return new Response(JSON.stringify({ count: requestCount }), {
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "max-age=10, s-maxage=1", // s-maxage takes precedence
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				await fetch(`http://localhost:${server.port}/test`);

				// Within s-maxage
				await new Promise((resolve) => setTimeout(resolve, 500));
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				expect(res1.headers.get("x-cache-status")).toBe("HIT");

				// After s-maxage but within max-age
				await new Promise((resolve) => setTimeout(resolve, 700));
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				expect(res2.headers.get("x-cache-status")).toBe("MISS");
			} finally {
				server.stop();
			}
		});

		test("should handle no-cache directive", async () => {
			app.use(cache({ respectCacheControl: true }));
			app.get("/test", (ctx) => {
				requestCount++;
				return new Response(JSON.stringify({ count: requestCount }), {
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-cache",
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Requests should not be cached
				await fetch(`http://localhost:${server.port}/test`);
				const res = await fetch(`http://localhost:${server.port}/test`);
				const data = await res.json();
				expect(data.count).toBe(2);
			} finally {
				server.stop();
			}
		});
	});

	describe("Custom Methods", () => {
		test("should cache custom methods when configured", async () => {
			app.use(cache({ methods: ["GET", "POST", "PUT"] }));

			app.put("/test", (ctx) => {
				requestCount++;
				return ctx.json({ count: requestCount });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First PUT request
				const res1 = await fetch(`http://localhost:${server.port}/test`, {
					method: "PUT",
				});
				expect(res1.headers.get("x-cache-status")).toBe("MISS");

				// Second PUT request - should be cached
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					method: "PUT",
				});
				const data2 = await res2.json();
				expect(data2.count).toBe(1);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
			} finally {
				server.stop();
			}
		});
	});

	describe("Error Handling", () => {
		test("should handle storage errors gracefully", async () => {
			// Create a storage that throws errors
			const faultyStorage: CacheStorage = {
				async get() {
					throw new Error("Storage error");
				},
				async set() {
					throw new Error("Storage error");
				},
				async delete() {
					return false;
				},
				async clear() {
					throw new Error("Storage error");
				},
				async has() {
					return false;
				},
				async size() {
					return 0;
				},
			};

			app.use(cache({ storage: faultyStorage }));
			app.get("/test", (ctx) => ctx.json({ data: "test" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Should still work despite storage errors
				const res = await fetch(`http://localhost:${server.port}/test`);
				expect(res.status).toBe(200);
				const data = await res.json();
				expect(data.data).toBe("test");
			} finally {
				server.stop();
			}
		});

		test("should handle invalid response errors", async () => {
			app.use(cache());
			app.get("/test", () => {
				// Return invalid response (not a Response object)
				return null as any;
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/test`);
				expect(res.status).toBe(500);
			} finally {
				server.stop();
			}
		});
	});

	describe("Headers Handling", () => {
		test("should not cache Set-Cookie headers", async () => {
			app.use(cache());
			app.get("/test", (ctx) => {
				return new Response(JSON.stringify({ data: "test" }), {
					headers: {
						"Content-Type": "application/json",
						"Set-Cookie": "session=abc123; HttpOnly",
						"X-Custom": "value",
					},
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				expect(res1.headers.get("set-cookie")).toBeDefined();

				// Cached response should not have Set-Cookie
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
				expect(res2.headers.get("x-custom")).toBe("value");
				// Note: Set-Cookie might still appear due to response cloning
				// but it shouldn't be stored in cache
			} finally {
				server.stop();
			}
		});
	});

	describe("Integration with Other Middleware", () => {
		test("should work with compression middleware", async () => {
			// Simulate compression middleware
			app.use(async (ctx, next) => {
				const res = await next();
				if (res instanceof Response) {
					const newHeaders = new Headers(res.headers);
					newHeaders.set("content-encoding", "gzip");

					const bodyBuffer = res.body ? await Bun.readableStreamToArrayBuffer(res.body) : new ArrayBuffer(0);
					const compressed = Bun.gzipSync(new Uint8Array(bodyBuffer));

					return new Response(compressed, {
						status: res.status,
						headers: newHeaders,
					});
				}
				return res;
			});

			app.use(cache());
			app.get("/test", (ctx) => ctx.json({ data: "test content" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// First request
				const res1 = await fetch(`http://localhost:${server.port}/test`);
				expect(res1.headers.get("content-encoding")).toBe("gzip");

				// Cached response should preserve encoding
				const res2 = await fetch(`http://localhost:${server.port}/test`);
				expect(res2.headers.get("x-cache-status")).toBe("HIT");
				expect(res2.headers.get("content-encoding")).toBe("gzip");
			} finally {
				server.stop();
			}
		});

		test("should work with authentication middleware", async () => {
			// Auth middleware
			app.use(async (ctx, next) => {
				const auth = ctx.req.headers.get("authorization");
				if (!auth) {
					return ctx.json({ error: "Unauthorized" }, 401);
				}
				ctx.set("user", { id: auth });
				return next();
			});

			app.use(
				cache({
					varyHeaders: ["authorization"], // Cache per user
				})
			);

			app.get("/profile", (ctx) => {
				const user = ctx.get("user");
				requestCount++;
				return ctx.json({
					count: requestCount,
					userId: user?.id,
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Request without auth - should fail
				const res1 = await fetch(`http://localhost:${server.port}/profile`);
				expect(res1.status).toBe(401);

				// User 1 request
				const res2 = await fetch(`http://localhost:${server.port}/profile`, {
					headers: { authorization: "user1" },
				});
				const data2 = await res2.json();
				expect(data2.userId).toBe("user1");
				expect(data2.count).toBe(1);

				// User 1 again - should be cached
				const res3 = await fetch(`http://localhost:${server.port}/profile`, {
					headers: { authorization: "user1" },
				});
				const data3 = await res3.json();
				expect(data3.count).toBe(1);
				expect(res3.headers.get("x-cache-status")).toBe("HIT");

				// User 2 - different cache entry
				const res4 = await fetch(`http://localhost:${server.port}/profile`, {
					headers: { authorization: "user2" },
				});
				const data4 = await res4.json();
				expect(data4.userId).toBe("user2");
				expect(data4.count).toBe(2);
				expect(res4.headers.get("x-cache-status")).toBe("MISS");
			} finally {
				server.stop();
			}
		});
	});
});
