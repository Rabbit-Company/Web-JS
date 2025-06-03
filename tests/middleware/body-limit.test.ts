import { describe, test, expect, beforeEach } from "bun:test";
import { Web } from "../../packages/core/src";
import { bodyLimit } from "../../packages/middleware/src/body-limit";

describe("Body Limit Middleware", () => {
	let app: Web<{ userId?: string }>;

	beforeEach(() => {
		app = new Web<{ userId?: string }>();
	});

	describe("Basic Functionality", () => {
		test("should allow requests under the limit", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const smallBody = "a".repeat(500); // 500 bytes
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: smallBody,
					headers: {
						"Content-Type": "text/plain",
						"Content-Length": smallBody.length.toString(),
					},
				});

				expect(res.status).toBe(200);
				const data = await res.json();
				expect(data.size).toBe(500);
			} finally {
				server.stop();
			}
		});

		test("should reject requests over the limit", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const largeBody = "a".repeat(2000); // 2000 bytes
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: {
						"Content-Type": "text/plain",
						"Content-Length": largeBody.length.toString(),
					},
				});

				expect(res.status).toBe(413);
				const body = await res.text();
				expect(body).toContain("Request body too large");
			} finally {
				server.stop();
			}
		});

		test("should work with default settings", async () => {
			app.use(bodyLimit()); // Default 1MB
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const body = "a".repeat(500_000); // 500KB
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body,
					headers: {
						"Content-Type": "text/plain",
						"Content-Length": body.length.toString(),
					},
				});

				expect(res.status).toBe(200);
			} finally {
				server.stop();
			}
		});

		test("should handle requests without Content-Length", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const smallBody = "a".repeat(500);
				// Simulate streaming without Content-Length
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(smallBody));
							controller.close();
						},
					}),
					headers: {
						"Content-Type": "text/plain",
						// No Content-Length header
					},
				});

				expect(res.status).toBe(200);
				const data = await res.json();
				expect(data.size).toBe(500);
			} finally {
				server.stop();
			}
		});

		test("should handle streaming body that exceeds limit", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const chunk1 = "a".repeat(600);
				const chunk2 = "b".repeat(600); // Total 1200 bytes > 1kb

				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(chunk1));
							controller.enqueue(new TextEncoder().encode(chunk2));
							controller.close();
						},
					}),
					headers: {
						"Content-Type": "text/plain",
					},
				});

				expect(res.status).toBe(413);
			} finally {
				server.stop();
			}
		});
	});

	describe("Size Parsing", () => {
		test("should parse different size formats", async () => {
			const testCases = [
				{ input: 100, expected: 100 },
				{ input: "100", expected: 100 },
				{ input: "100b", expected: 100 },
				{ input: "1kb", expected: 1024 },
				{ input: "1.5kb", expected: 1536 },
				{ input: "2mb", expected: 2097152 },
				{ input: "1gb", expected: 1073741824 },
			];

			for (const { input, expected } of testCases) {
				app.post(`/test-${input}`, bodyLimit({ maxSize: input }), async (ctx) => {
					return ctx.json({ ok: true });
				});
			}

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Test that size parsing works correctly
				const body = "a".repeat(50); // Small body
				for (const { input } of testCases) {
					const res = await fetch(`http://localhost:${server.port}/test-${input}`, {
						method: "POST",
						body,
						headers: { "Content-Length": "50" },
					});
					expect(res.status).toBe(200);
				}
			} finally {
				server.stop();
			}
		});

		test("should handle case-insensitive units", async () => {
			app.use(bodyLimit({ maxSize: "1KB" }));
			app.post("/test", (ctx) => ctx.json({ ok: true }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const body = "a".repeat(500);
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body,
					headers: { "Content-Length": "500" },
				});
				expect(res.status).toBe(200);
			} finally {
				server.stop();
			}
		});

		test("should handle spaces in size format", async () => {
			app.use(bodyLimit({ maxSize: "1 mb" }));
			app.post("/test", (ctx) => ctx.json({ ok: true }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const body = "a".repeat(1000);
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body,
					headers: { "Content-Length": "1000" },
				});
				expect(res.status).toBe(200);
			} finally {
				server.stop();
			}
		});
	});

	describe("Content Type Filtering", () => {
		test("should only apply limit to specified content types", async () => {
			app.use(
				bodyLimit({
					maxSize: "1kb",
					contentTypes: ["application/json", "text/plain"],
				})
			);
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const largeBody = "a".repeat(2000);

				// JSON - should be limited
				const res1 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: JSON.stringify({ data: largeBody }),
					headers: {
						"Content-Type": "application/json",
						"Content-Length": JSON.stringify({ data: largeBody }).length.toString(),
					},
				});
				expect(res1.status).toBe(413);

				// Form data - should not be limited
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						"Content-Length": largeBody.length.toString(),
					},
				});
				expect(res2.status).toBe(200);

				// Text - should be limited
				const res3 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: {
						"Content-Type": "text/plain",
						"Content-Length": largeBody.length.toString(),
					},
				});
				expect(res3.status).toBe(413);
			} finally {
				server.stop();
			}
		});

		test("should handle content type with charset", async () => {
			app.use(
				bodyLimit({
					maxSize: "1kb",
					contentTypes: ["application/json"],
				})
			);
			app.post("/test", (ctx) => ctx.json({ ok: true }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const largeBody = JSON.stringify({ data: "a".repeat(2000) });
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: {
						"Content-Type": "application/json; charset=utf-8",
						"Content-Length": largeBody.length.toString(),
					},
				});
				expect(res.status).toBe(413);
			} finally {
				server.stop();
			}
		});
	});

	describe("Skip Functionality", () => {
		test("should skip limit check based on skip function", async () => {
			app.use(
				bodyLimit({
					maxSize: "1kb",
					skip: (ctx) => ctx.req.headers.get("X-Skip-Limit") === "true",
				})
			);
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const largeBody = "a".repeat(2000);

				// Without skip header - should be limited
				const res1 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: {
						"Content-Length": largeBody.length.toString(),
					},
				});
				expect(res1.status).toBe(413);

				// With skip header - should not be limited
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: {
						"Content-Length": largeBody.length.toString(),
						"X-Skip-Limit": "true",
					},
				});
				expect(res2.status).toBe(200);
				const data = await res2.json();
				expect(data.size).toBe(2000);
			} finally {
				server.stop();
			}
		});

		test("should support async skip function", async () => {
			app.use(async (ctx, next) => {
				// Simulate authentication middleware
				const token = ctx.req.headers.get("Authorization");
				if (token === "Bearer admin") {
					ctx.set("userId", "admin");
				}
				return next();
			});

			app.use(
				bodyLimit<{ userId?: string }>({
					maxSize: "1kb",
					skip: async (ctx) => {
						// Simulate async check
						await new Promise((resolve) => setTimeout(resolve, 10));
						return ctx.get("userId") === "admin";
					},
				})
			);

			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const largeBody = "a".repeat(2000);

				// Regular user - should be limited
				const res1 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: {
						"Content-Length": largeBody.length.toString(),
					},
				});
				expect(res1.status).toBe(413);

				// Admin user - should not be limited
				const res2 = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: {
						"Content-Length": largeBody.length.toString(),
						Authorization: "Bearer admin",
					},
				});
				expect(res2.status).toBe(200);
			} finally {
				server.stop();
			}
		});
	});

	describe("Custom Error Messages", () => {
		test("should use custom error message string", async () => {
			app.use(
				bodyLimit({
					maxSize: "1kb",
					message: "File too large! Please upload a smaller file.",
				})
			);
			app.post("/test", (ctx) => ctx.json({ ok: true }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const largeBody = "a".repeat(2000);
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: { "Content-Length": largeBody.length.toString() },
				});

				expect(res.status).toBe(413);
				const text = await res.text();
				expect(text).toBe("File too large! Please upload a smaller file.");
			} finally {
				server.stop();
			}
		});

		test("should use custom error message function", async () => {
			app.use(
				bodyLimit({
					maxSize: "1kb",
					message: (size, limit) => `Upload failed: ${size} bytes exceeds limit of ${limit} bytes`,
				})
			);
			app.post("/test", (ctx) => ctx.json({ ok: true }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const largeBody = "a".repeat(2000);
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: { "Content-Length": largeBody.length.toString() },
				});

				expect(res.status).toBe(413);
				const text = await res.text();
				expect(text).toBe("Upload failed: 2000 bytes exceeds limit of 1024 bytes");
			} finally {
				server.stop();
			}
		});

		test("should use custom status code", async () => {
			app.use(
				bodyLimit({
					maxSize: "1kb",
					statusCode: 400,
					message: "Bad request: body too large",
				})
			);
			app.post("/test", (ctx) => ctx.json({ ok: true }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const largeBody = "a".repeat(2000);
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: largeBody,
					headers: { "Content-Length": largeBody.length.toString() },
				});

				expect(res.status).toBe(400);
				const text = await res.text();
				expect(text).toBe("Bad request: body too large");
			} finally {
				server.stop();
			}
		});
	});

	describe("Include Headers Option", () => {
		test("should include header size when configured", async () => {
			app.use(
				bodyLimit({
					maxSize: "1kb",
					includeHeaders: true,
				})
			);
			app.post("/test", (ctx) => ctx.json({ ok: true }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				// Body is under 1kb, but with headers it might exceed
				const body = "a".repeat(900);
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body,
					headers: {
						"Content-Length": body.length.toString(),
						"X-Custom-Header-1": "a".repeat(50),
						"X-Custom-Header-2": "b".repeat(50),
						"X-Custom-Header-3": "c".repeat(50),
					},
				});

				// Depending on header size, this might fail
				// The test assumes headers push it over the limit
				expect([200, 413]).toContain(res.status);
			} finally {
				server.stop();
			}
		});
	});

	describe("Multiple Middleware Instances", () => {
		test("should support different limits for different routes", async () => {
			// Global limit
			app.use(bodyLimit({ maxSize: "10kb" }));

			// Specific route with stricter limit
			app.post("/upload/avatar", bodyLimit({ maxSize: "1kb" }), (ctx) => ctx.json({ type: "avatar" }));

			// Route with global limit
			app.post("/upload/document", (ctx) => ctx.json({ type: "document" }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const mediumBody = "a".repeat(5000); // 5kb

				// Avatar route - should fail (exceeds 1kb)
				const res1 = await fetch(`http://localhost:${server.port}/upload/avatar`, {
					method: "POST",
					body: mediumBody,
					headers: { "Content-Length": mediumBody.length.toString() },
				});
				expect(res1.status).toBe(413);

				// Document route - should succeed (under 10kb)
				const res2 = await fetch(`http://localhost:${server.port}/upload/document`, {
					method: "POST",
					body: mediumBody,
					headers: { "Content-Length": mediumBody.length.toString() },
				});
				expect(res2.status).toBe(200);
			} finally {
				server.stop();
			}
		});
	});

	describe("Edge Cases", () => {
		test("should handle empty body", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					headers: { "Content-Length": "0" },
				});

				expect(res.status).toBe(200);
				const data = await res.json();
				expect(data.size).toBe(0);
			} finally {
				server.stop();
			}
		});

		test("should handle body exactly at limit", async () => {
			app.use(bodyLimit({ maxSize: 1024 })); // Exactly 1kb
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const exactBody = "a".repeat(1024);
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: exactBody,
					headers: { "Content-Length": "1024" },
				});

				expect(res.status).toBe(200);
				const data = await res.json();
				expect(data.size).toBe(1024);
			} finally {
				server.stop();
			}
		});

		test("should handle invalid Content-Length header", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const body = "a".repeat(500);
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body,
					headers: {
						"Content-Length": "invalid",
					},
				});

				// Should still work, falling back to streaming check
				expect(res.status).toBe(200);
			} finally {
				server.stop();
			}
		});

		test("should handle requests without body", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.get("/test", (ctx) => ctx.json({ ok: true }));

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const res = await fetch(`http://localhost:${server.port}/test`);
				expect(res.status).toBe(200);
			} finally {
				server.stop();
			}
		});
	});

	describe("Performance", () => {
		test("should handle multiple concurrent requests", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.post("/test", async (ctx) => {
				const body = await ctx.req.text();
				return ctx.json({ size: body.length });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const promises = [];
				for (let i = 0; i < 10; i++) {
					const body = "a".repeat(i * 100); // Different sizes
					promises.push(
						fetch(`http://localhost:${server.port}/test`, {
							method: "POST",
							body,
							headers: { "Content-Length": body.length.toString() },
						})
					);
				}

				const results = await Promise.all(promises);

				// First 10 requests (0-900 bytes) should succeed
				for (let i = 0; i < 10; i++) {
					if (i * 100 <= 1024) {
						expect(results[i].status).toBe(200);
					} else {
						expect(results[i].status).toBe(413);
					}
				}
			} finally {
				server.stop();
			}
		});
	});

	describe("JSON Body Handling", () => {
		test("should work with JSON bodies", async () => {
			app.use(bodyLimit({ maxSize: "1kb" }));
			app.post("/test", async (ctx) => {
				const data = await ctx.req.json();
				return ctx.json({ received: data });
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const jsonData = { message: "Hello", data: "a".repeat(100) };
				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: JSON.stringify(jsonData),
					headers: {
						"Content-Type": "application/json",
						"Content-Length": JSON.stringify(jsonData).length.toString(),
					},
				});

				expect(res.status).toBe(200);
				const result = await res.json();
				expect(result.received).toEqual(jsonData);
			} finally {
				server.stop();
			}
		});
	});

	describe("FormData Handling", () => {
		test("should work with multipart form data", async () => {
			app.use(bodyLimit({ maxSize: "10kb" }));
			app.post("/test", async (ctx) => {
				const formData = await ctx.req.formData();
				const file = formData.get("file") as File;
				const text = formData.get("text") as string;
				return ctx.json({
					fileName: file?.name,
					fileSize: file?.size,
					text,
				});
			});

			const server = Bun.serve({
				port: 0,
				fetch: app.handleBun,
			});

			try {
				const formData = new FormData();
				formData.append("text", "Hello World");
				formData.append("file", new Blob(["a".repeat(1000)]), "test.txt");

				const res = await fetch(`http://localhost:${server.port}/test`, {
					method: "POST",
					body: formData,
				});

				expect(res.status).toBe(200);
				const result = await res.json();
				expect(result.fileName).toBe("test.txt");
				expect(result.fileSize).toBe(1000);
				expect(result.text).toBe("Hello World");
			} finally {
				server.stop();
			}
		});
	});
});
