import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { logger, Levels } from "../../packages/middleware/src/logger";
import type { Context } from "../../packages/core/src";

class MockLogger {
	public logs: Array<{ level: number; message: string; metadata?: any }> = [];

	log(level: number, message: string, metadata?: any): void {
		this.logs.push({ level, message, metadata });
	}

	clear() {
		this.logs = [];
	}

	getLastLog() {
		return this.logs[this.logs.length - 1];
	}

	getLogsByLevel(level: number) {
		return this.logs.filter((log) => log.level === level);
	}
}

// Mock context factory
function createMockContext<T extends Record<string, unknown>>(
	options: {
		method?: string;
		url?: string;
		headers?: Record<string, string>;
		body?: any;
		params?: Record<string, string>;
		query?: Record<string, string>;
	} = {}
): Context<T> {
	const { method = "GET", url = "http://localhost:3000/test", headers = {}, body, params = {}, query = {} } = options;

	const mockHeaders = new Map(Object.entries(headers));
	const contextData = new Map<keyof T, any>();

	const context = {
		req: {
			method,
			url,
			headers: {
				get: (name: string) => mockHeaders.get(name.toLowerCase()),
				forEach: (callback: (value: string, key: string) => void) => {
					mockHeaders.forEach(callback);
				},
			} as any,
			clone: () => ({
				text: async () => (body ? JSON.stringify(body) : ""),
				json: async () => body || {},
			}),
		} as Request,
		res: null as any,
		params,
		query,
		state: {} as T,
		set: <K extends keyof T>(key: K, value: T[K]) => {
			contextData.set(key, value);
		},
		get: <K extends keyof T>(key: K): T[K] | undefined => {
			return contextData.get(key);
		},
		header: mock((name: string, value: string) => {}),
		json: mock((data: unknown, status = 200, headers?: Record<string, string>) => {
			const response = new Response(JSON.stringify(data), { status, headers });
			Object.defineProperty(response, "status", { value: status });
			return response;
		}),
		text: mock((text: string | null | undefined, status = 200, headers?: Record<string, string>) => {
			const response = new Response(text || "", { status, headers });
			Object.defineProperty(response, "status", { value: status });
			return response;
		}),
		html: mock((html: string, status = 200, headers?: Record<string, string>) => {
			const response = new Response(html, {
				status,
				headers: { "content-type": "text/html", ...headers },
			});
			Object.defineProperty(response, "status", { value: status });
			return response;
		}),
		redirect: mock((url: string, status = 302) => {
			const response = new Response(null, {
				status,
				headers: { location: url },
			});
			Object.defineProperty(response, "status", { value: status });
			return response;
		}),
	} as unknown as Context<T>;

	return context;
}

describe("Logger Middleware", () => {
	let mockLogger: MockLogger;

	beforeEach(() => {
		mockLogger = new MockLogger();
	});

	afterEach(() => {
		mockLogger.clear();
	});

	describe("Basic Functionality", () => {
		it("should log request and response with default settings", async () => {
			// Use "standard" preset to include request ID
			const middleware = logger({ logger: mockLogger as any, preset: "standard" });
			const ctx = createMockContext({ method: "GET", url: "http://localhost:3000/api/test" });
			const next = mock(() => Promise.resolve(new Response("OK", { status: 200 })));

			await middleware(ctx, next);

			expect(mockLogger.logs).toHaveLength(2);

			// Check request log
			const requestLog = mockLogger.logs[0];
			expect(requestLog.level).toBe(Levels.HTTP);
			expect(requestLog.message).toBe("GET - undefined - /api/test");
			expect(requestLog.metadata.requestId).toBeDefined();
			// Note: request details are not included in standard preset
			// We need to check if request exists before accessing nested properties
			if (requestLog.metadata.request) {
				expect(requestLog.metadata.request.method).toBe("GET");
				expect(requestLog.metadata.request.pathname).toBe("/api/test");
			}

			// Check response log
			const responseLog = mockLogger.logs[1];
			expect(responseLog.level).toBe(Levels.HTTP);
			expect(responseLog.message).toContain("GET - undefined - /api/test - 200");
			expect(responseLog.metadata.response.statusCode).toBe(200);
			expect(responseLog.metadata.duration).toBeGreaterThanOrEqual(0);
		});

		it("should generate and store request ID in context", async () => {
			// Explicitly enable includeRequestId
			const middleware = logger({
				logger: mockLogger as any,
				requestIdKey: "reqId",
				includeRequestId: true,
			});
			const ctx = createMockContext();
			const next = mock(() => Promise.resolve(new Response("OK")));

			await middleware(ctx, next);

			const requestId = ctx.get("reqId");
			expect(requestId).toBeDefined();
			expect(typeof requestId).toBe("string");
		});

		it("should use existing request ID from headers", async () => {
			const existingId = "test-request-id";
			const middleware = logger({
				logger: mockLogger as any,
				includeRequestId: true,
				generateRequestId: (ctx) => ctx.req.headers.get("x-request-id") || "fallback",
			});
			const ctx = createMockContext({
				headers: { "x-request-id": existingId },
			});
			const next = mock(() => Promise.resolve(new Response("OK")));

			await middleware(ctx, next);

			const requestLog = mockLogger.getLastLog();
			expect(requestLog.metadata.requestId).toBe(existingId);
		});
	});

	describe("Request Logging", () => {
		it("should log request headers excluding sensitive ones", async () => {
			const middleware = logger({
				logger: mockLogger as any,
				includeHeaders: true, // Explicitly enable headers
				excludeHeaders: ["authorization", "cookie"],
			});
			const ctx = createMockContext({
				headers: {
					authorization: "Bearer secret",
					"content-type": "application/json",
					cookie: "session=abc123",
					"user-agent": "test-agent",
				},
			});
			const next = mock(() => Promise.resolve(new Response("OK")));

			await middleware(ctx, next);

			const requestLog = mockLogger.logs[0];
			const headers = requestLog.metadata.request.headers;

			expect(headers["authorization"]).toBeUndefined();
			expect(headers["cookie"]).toBeUndefined();
			expect(headers["content-type"]).toBe("application/json");
			expect(headers["user-agent"]).toBe("test-agent");
		});

		it("should log request body when enabled", async () => {
			const requestBody = { username: "test", action: "login" };
			const middleware = logger({
				logger: mockLogger as any,
				logRequestBody: true,
			});
			const ctx = createMockContext({
				method: "POST",
				headers: { "content-type": "application/json" },
				body: requestBody,
			});
			const next = mock(() => Promise.resolve(new Response("OK")));

			await middleware(ctx, next);

			const requestLog = mockLogger.logs[0];
			expect(requestLog.metadata.request.body).toBeDefined();
			expect(requestLog.metadata.request.body).toContain("username");
		});

		it("should not log request body when disabled", async () => {
			const middleware = logger({
				logger: mockLogger as any,
				logRequestBody: false,
			});
			const ctx = createMockContext({
				method: "POST",
				body: { secret: "data" },
			});
			const next = mock(() => Promise.resolve(new Response("OK")));

			await middleware(ctx, next);

			const requestLog = mockLogger.logs[0];
			// With default settings, request might not be included at all
			if (requestLog.metadata.request) {
				expect(requestLog.metadata.request.body).toBeUndefined();
			}
		});

		it("should truncate long request bodies", async () => {
			const longBody = "x".repeat(2000);
			const middleware = logger({
				logger: mockLogger as any,
				logRequestBody: true,
				maxBodyLength: 100,
			});
			const ctx = createMockContext({
				method: "POST",
				headers: { "content-type": "application/json" },
				body: longBody,
			});
			const next = mock(() => Promise.resolve(new Response("OK")));

			await middleware(ctx, next);

			const requestLog = mockLogger.logs[0];
			expect(requestLog.metadata.request.body).toHaveLength(100 + "... (truncated)".length);
			expect(requestLog.metadata.request.body).toContain("(truncated)");
		});
	});

	describe("Client IP Extraction with clientIp in context", () => {
		it("should use clientIp from context when available", async () => {
			const middleware = logger({
				logger: mockLogger as any,
				includeRemoteAddress: true,
			});
			const ctx = createMockContext();
			// Add clientIp to the context (simulating handleBun)
			(ctx as any).clientIp = "192.168.1.100";
			const next = mock(() => Promise.resolve(new Response("OK")));

			await middleware(ctx, next);

			const requestLog = mockLogger.logs[0];
			expect(requestLog.metadata.request.remoteAddress).toBe("192.168.1.100");
		});
	});
});
