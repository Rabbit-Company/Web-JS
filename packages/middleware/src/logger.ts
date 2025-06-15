import type { Context, Middleware } from "@rabbit-company/web";
import { Logger, Levels, ConsoleTransport } from "@rabbit-company/logger";

/**
 * Options for configuring the logger middleware.
 */
export interface LoggerOptions<T extends Record<string, unknown>, B extends Record<string, unknown>> {
	/**
	 * Logger instance to use. If not provided, a default logger will be created.
	 */
	logger?: Logger;

	/**
	 * Log level for HTTP requests.
	 * Default: Levels.HTTP
	 */
	level?: number;

	/**
	 * Preset configuration for common use cases.
	 * Overrides individual options when specified.
	 * - "minimal": Just method, path, status, and duration
	 * - "standard": Adds request ID and basic metadata
	 * - "detailed": Includes headers and user info
	 * - "debug": Full logging with bodies (for development)
	 */
	preset?: "minimal" | "standard" | "detailed" | "debug";

	/**
	 * Whether to log request details.
	 * Default: true
	 */
	logRequests?: boolean;

	/**
	 * Whether to log response details.
	 * Default: true
	 */
	logResponses?: boolean;

	/**
	 * Whether to log request/response duration.
	 * Default: true
	 */
	logDuration?: boolean;

	/**
	 * Whether to include request ID in logs.
	 * Default: true
	 */
	includeRequestId?: boolean;

	/**
	 * Whether to include request headers.
	 * Default: false
	 */
	includeHeaders?: boolean;

	/**
	 * Whether to include user agent.
	 * Default: false
	 */
	includeUserAgent?: boolean;

	/**
	 * Whether to include remote IP address.
	 * Default: false
	 */
	includeRemoteAddress?: boolean;

	/**
	 * Whether to log request body (be careful with sensitive data).
	 * Default: false
	 */
	logRequestBody?: boolean;

	/**
	 * Whether to log response body (be careful with large responses).
	 * Default: false
	 */
	logResponseBody?: boolean;

	/**
	 * Maximum length of logged bodies (in characters).
	 * Default: 1000
	 */
	maxBodyLength?: number;

	/**
	 * Headers to exclude from logging (case-insensitive).
	 * Default: ["authorization", "cookie", "set-cookie"]
	 */
	excludeHeaders?: string[];

	/**
	 * Paths to exclude from logging (exact match or regex).
	 * Default: ["/health", "/ping"]
	 */
	excludePaths?: (string | RegExp)[];

	/**
	 * HTTP status codes to exclude from logging.
	 * Default: []
	 */
	excludeStatusCodes?: number[];

	/**
	 * Function to generate request ID. If not provided, a random ID will be generated.
	 */
	generateRequestId?: (ctx: Context<T, B>) => string;

	/**
	 * Key in context where request ID will be stored.
	 * Default: "requestId"
	 */
	requestIdKey?: keyof T;

	/**
	 * Function to extract user identifier for logging.
	 */
	getUserId?: (ctx: Context<T, B>) => string | undefined;

	/**
	 * Function to determine if a request should be skipped.
	 */
	skip?: (ctx: Context<T, B>) => boolean | Promise<boolean>;

	/**
	 * Custom message formatter for request logs.
	 */
	formatRequestMessage?: (ctx: Context<T, B>, requestId: string) => string;

	/**
	 * Custom message formatter for response logs.
	 */
	formatResponseMessage?: (ctx: Context<T, B>, requestId: string, duration: number, statusCode: number) => string;

	/**
	 * Additional metadata to include in all logs.
	 */
	metadata?: Record<string, unknown> | ((ctx: Context<T, B>) => Record<string, unknown>);
}

/**
 * HTTP request/response logging middleware using @rabbit-company/logger.
 *
 * Provides comprehensive logging of HTTP traffic with customizable options
 * for security, performance, and debugging needs.
 *
 * @example
 * ```typescript
 * // Minimal logging (clean, just the essentials)
 * app.use(logger({ preset: "minimal" }));
 * // Output: GET /api/users 200 45ms
 *
 * // Standard logging (adds request ID)
 * app.use(logger({ preset: "standard" }));
 *
 * // Detailed logging (includes headers and IPs)
 * app.use(logger({ preset: "detailed" }));
 *
 * // Debug logging (everything including bodies)
 * app.use(logger({ preset: "debug" }));
 *
 * // Custom minimal configuration
 * app.use(logger({
 *   logRequestBody: false,
 *   logResponses: false,
 *   includeHeaders: false,
 *   includeRequestId: false
 * }));
 *
 * // Basic usage with default logger
 * app.use(logger());
 *
 * // Custom logger with specific transports
 * const customLogger = new Logger({
 *   level: Levels.INFO,
 *   transports: [
 *     new ConsoleTransport(),
 *     new LokiTransport({ url: "http://localhost:3100" })
 *   ]
 * });
 *
 * app.use(logger({
 *   logger: customLogger,
 *   logDuration: true,
 *   excludePaths: ["/health", "/metrics", /^\/static/]
 * }));
 *
 * // Detailed logging for debugging
 * app.use(logger({
 *   level: Levels.DEBUG,
 *   logRequestBody: true,
 *   logResponseBody: true,
 *   maxBodyLength: 5000,
 *   getUserId: (ctx) => ctx.get("user")?.id,
 *   metadata: { service: "api", version: "1.0.0" }
 * }));
 *
 * // Production logging with security considerations
 * app.use(logger({
 *   level: Levels.INFO,
 *   logRequestBody: false,
 *   logResponseBody: false,
 *   excludeHeaders: ["authorization", "cookie", "x-api-key"],
 *   excludePaths: ["/health", "/ping"],
 *   excludeStatusCodes: [404],
 *   skip: (ctx) => ctx.req.headers.get("user-agent")?.includes("healthcheck")
 * }));
 * ```
 */
export function logger<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	options: LoggerOptions<T, B> = {}
): Middleware<T, B> {
	// Apply preset configurations
	const presetConfig = getPresetConfiguration<T, B>(options.preset);
	const mergedOptions = { ...presetConfig, ...options };

	const {
		logger: providedLogger,
		level = Levels.HTTP,
		logRequests = true,
		logResponses = true,
		logDuration = true,
		includeRequestId = true,
		includeHeaders = false,
		includeUserAgent = false,
		includeRemoteAddress = false,
		logRequestBody = false,
		logResponseBody = false,
		maxBodyLength = 1000,
		excludeHeaders = ["authorization", "cookie", "set-cookie"],
		excludePaths = ["/health", "/ping"],
		excludeStatusCodes = [],
		generateRequestId = defaultRequestIdGenerator,
		requestIdKey = "requestId" as keyof T,
		getUserId,
		skip,
		formatRequestMessage = defaultRequestFormatter,
		formatResponseMessage = defaultResponseFormatter,
		metadata,
	}: LoggerOptions<T, B> = mergedOptions;

	// Create default logger if none provided
	const loggerInstance =
		providedLogger ||
		new Logger({
			level,
			transports: [new ConsoleTransport()],
		});

	// Normalize exclude headers to lowercase
	const normalizedExcludeHeaders = excludeHeaders.map((h) => h.toLowerCase());

	return async (ctx: Context<T, B>, next) => {
		// Check if request should be skipped
		if (skip && skip(ctx)) {
			return next();
		}

		// Check if path should be excluded
		const url = new URL(ctx.req.url);
		const pathname = url.pathname;

		const shouldExcludePath = excludePaths.some((path) => {
			if (typeof path === "string") {
				return pathname === path;
			}
			return path.test(pathname);
		});

		if (shouldExcludePath) {
			return next();
		}

		// Generate request ID and store in context
		const requestId = includeRequestId ? generateRequestId(ctx) : undefined;
		if (requestId && includeRequestId) {
			ctx.set(requestIdKey, requestId as T[keyof T]);
		}

		// Start timing
		const startTime = Date.now();

		// Get base metadata
		const baseMetadata = getMetadata(metadata, ctx);
		const userId = getUserId ? getUserId(ctx) : undefined;

		// Log incoming request
		if (logRequests) {
			const requestMetadata = await buildRequestMetadata(ctx, requestId, userId, baseMetadata, {
				includeRequestId,
				includeHeaders,
				includeUserAgent,
				includeRemoteAddress,
				logRequestBody,
				maxBodyLength,
				normalizedExcludeHeaders,
			});

			const message = formatRequestMessage(ctx, requestId || "");
			loggerInstance.log(level, message, requestMetadata);
		}

		// Capture response for logging
		let responseBody: string | undefined;
		let statusCode = 200;

		// Store original response methods if we need to log response body
		const originalJson = ctx.json.bind(ctx);
		const originalText = ctx.text.bind(ctx);

		if (logResponseBody) {
			// Intercept response methods to capture body
			ctx.json = function (data: unknown, status?: number, headers?: Record<string, string>) {
				responseBody = JSON.stringify(data);
				statusCode = status || 200;
				return originalJson(data, status, headers);
			};

			ctx.text = function (body: string | null | undefined, status?: number, headers?: Record<string, string>) {
				responseBody = body || "";
				statusCode = status || 200;
				return originalText(body, status, headers);
			};
		}

		try {
			// Execute next middleware
			const response = await next();

			// Calculate duration
			const duration = Date.now() - startTime;

			// Get final status code
			if (response instanceof Response) {
				statusCode = response.status;
			}

			// Check if status code should be excluded
			if (excludeStatusCodes.includes(statusCode)) {
				return response;
			}

			// Log response
			if (logResponses) {
				const responseMetadata = buildResponseMetadata(requestId, userId, duration, statusCode, responseBody, baseMetadata, {
					includeRequestId,
					logDuration,
					logResponseBody,
					maxBodyLength,
				});

				const message = formatResponseMessage(ctx, requestId || "", duration, statusCode);
				loggerInstance.log(level, message, responseMetadata);
			}

			return response;
		} catch (error) {
			// Calculate duration for error case
			const duration = Date.now() - startTime;

			// Log error response
			if (logResponses) {
				const errorMetadata = {
					...baseMetadata,
					...(includeRequestId && requestId ? { requestId } : {}),
					...(userId ? { userId } : {}),
					...(logDuration ? { duration } : {}),
					statusCode: 500,
					error: {
						name: error instanceof Error ? error.name : "Unknown",
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					},
				};

				const message = formatResponseMessage(ctx, requestId || "", duration, 500);
				loggerInstance.log(Levels.ERROR, message, errorMetadata);
			}

			throw error;
		}
	};
}

/**
 * Get preset configuration for common logging scenarios.
 */
function getPresetConfiguration<T extends Record<string, unknown>, B extends Record<string, unknown>>(preset?: string): LoggerOptions<T, B> {
	switch (preset) {
		case "minimal":
			return {
				includeRequestId: false,
				includeHeaders: false,
				includeUserAgent: false,
				includeRemoteAddress: false,
				logRequestBody: false,
				logResponseBody: false,
			};

		case "standard":
			return {
				includeRequestId: true,
				includeHeaders: false,
				includeUserAgent: false,
				includeRemoteAddress: false,
				logRequestBody: false,
				logResponseBody: false,
			};

		case "detailed":
			return {
				includeRequestId: true,
				includeHeaders: true,
				includeUserAgent: true,
				includeRemoteAddress: true,
				logRequestBody: false,
				logResponseBody: false,
			};

		case "debug":
			return {
				includeRequestId: true,
				includeHeaders: true,
				includeUserAgent: true,
				includeRemoteAddress: true,
				logRequestBody: true,
				logResponseBody: true,
				maxBodyLength: 5000,
			};

		default:
			return {
				includeRequestId: false,
				includeHeaders: false,
				includeUserAgent: false,
				includeRemoteAddress: false,
				logRequestBody: false,
				logResponseBody: false,
			};
	}
}
function defaultRequestIdGenerator<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	ctx: Context<T, B>
): string {
	// Try to use existing request ID from headers
	const existingId = ctx.req.headers.get("x-request-id") || ctx.req.headers.get("x-correlation-id");

	if (existingId) {
		return existingId;
	}

	// Generate new ID
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}

	// Fallback for older environments
	return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Default request message formatter.
 */
function defaultRequestFormatter<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	ctx: Context<T, B>,
	requestId: string
): string {
	const url = new URL(ctx.req.url);
	return `${ctx.req.method} - ${ctx.clientIp} - ${url.pathname}${url.search}`;
}

/**
 * Default response message formatter.
 */
function defaultResponseFormatter<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	ctx: Context<T, B>,
	requestId: string,
	duration: number,
	statusCode: number
): string {
	const url = new URL(ctx.req.url);
	return `${ctx.req.method} - ${ctx.clientIp} - ${url.pathname}${url.search} - ${statusCode} - ${duration}ms`;
}

/**
 * Build request metadata object.
 */
async function buildRequestMetadata<T extends Record<string, unknown>, B extends Record<string, unknown>>(
	ctx: Context<T, B>,
	requestId: string | undefined,
	userId: string | undefined,
	baseMetadata: Record<string, unknown>,
	options: {
		includeRequestId: boolean;
		includeHeaders: boolean;
		includeUserAgent: boolean;
		includeRemoteAddress: boolean;
		logRequestBody: boolean;
		maxBodyLength: number;
		normalizedExcludeHeaders: string[];
	}
): Promise<Record<string, unknown>> {
	const url = new URL(ctx.req.url);

	const metadata: Record<string, unknown> = {
		...baseMetadata,
		...(options.includeRequestId && requestId ? { requestId } : {}),
		...(userId ? { userId } : {}),
	};

	// Only include request details if any request options are enabled
	const includeRequestDetails = options.includeHeaders || options.includeUserAgent || options.includeRemoteAddress || options.logRequestBody;

	if (includeRequestDetails) {
		const requestData: Record<string, unknown> = {
			method: ctx.req.method,
			url: ctx.req.url,
			pathname: url.pathname,
			search: url.search,
		};

		// Add headers if enabled
		if (options.includeHeaders) {
			const headers: Record<string, string> = {};
			ctx.req.headers.forEach((value, key) => {
				if (!options.normalizedExcludeHeaders.includes(key.toLowerCase())) {
					headers[key] = value;
				}
			});
			requestData.headers = headers;
		}

		// Add user agent if enabled
		if (options.includeUserAgent) {
			requestData.userAgent = ctx.req.headers.get("user-agent");
		}

		// Add referer if enabled with headers
		if (options.includeHeaders) {
			requestData.referer = ctx.req.headers.get("referer");
		}

		// Add remote address if enabled
		if (options.includeRemoteAddress) {
			requestData.remoteAddress = ctx.clientIp;
		}

		// Add request body if enabled
		if (options.logRequestBody && (ctx.req.method === "POST" || ctx.req.method === "PUT" || ctx.req.method === "PATCH")) {
			try {
				const contentType = ctx.req.headers.get("content-type");
				if (contentType?.includes("application/json")) {
					const body = await ctx.req.clone().text();
					requestData.body = truncateString(body, options.maxBodyLength);
				}
			} catch (error) {
				// Ignore body parsing errors
			}
		}

		metadata.request = requestData;
	}

	return metadata;
}

/**
 * Build response metadata object.
 */
function buildResponseMetadata(
	requestId: string | undefined,
	userId: string | undefined,
	duration: number,
	statusCode: number,
	responseBody: string | undefined,
	baseMetadata: Record<string, unknown>,
	options: {
		includeRequestId: boolean;
		logDuration: boolean;
		logResponseBody: boolean;
		maxBodyLength: number;
	}
): Record<string, unknown> {
	const metadata: Record<string, unknown> = {
		...baseMetadata,
		...(options.includeRequestId && requestId ? { requestId } : {}),
		...(userId ? { userId } : {}),
		...(options.logDuration ? { duration } : {}),
		response: {
			statusCode,
			...(options.logResponseBody && responseBody ? { body: truncateString(responseBody, options.maxBodyLength) } : {}),
		},
	};

	return metadata;
}

/**
 * Get metadata from options.
 */
function getMetadata<T extends Record<string, unknown>, B extends Record<string, unknown>>(
	metadata: Record<string, unknown> | ((ctx: Context<T, B>) => Record<string, unknown>) | undefined,
	ctx: Context<T, B>
): Record<string, unknown> {
	if (!metadata) return {};
	if (typeof metadata === "function") return metadata(ctx);
	return metadata;
}

/**
 * Truncate string to maximum length.
 */
function truncateString(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;
	return str.substring(0, maxLength) + "... (truncated)";
}

/**
 * Create a logger instance with common transports.
 */
export function createWebLogger(
	options: {
		level?: number;
		console?: boolean;
		ndjson?: boolean;
		loki?: {
			url: string;
			labels?: Record<string, string>;
			basicAuth?: { username: string; password: string };
			batchSize?: number;
			batchTimeout?: number;
		};
		syslog?: {
			host: string;
			port?: number;
			protocol?: "udp" | "tcp" | "tcp-tls";
			facility?: number;
			appName?: string;
		};
	} = {}
): Logger {
	const { level = Levels.INFO, console: enableConsole = true } = options;
	const transports = [];

	if (enableConsole) {
		const { ConsoleTransport } = require("@rabbit-company/logger");
		transports.push(new ConsoleTransport());
	}

	if (options.ndjson) {
		const { NDJsonTransport } = require("@rabbit-company/logger");
		transports.push(new NDJsonTransport());
	}

	if (options.loki) {
		const { LokiTransport } = require("@rabbit-company/logger");
		transports.push(new LokiTransport(options.loki));
	}

	if (options.syslog) {
		const { SyslogTransport } = require("@rabbit-company/logger");
		transports.push(new SyslogTransport(options.syslog));
	}

	return new Logger({ level, transports });
}

export * from "@rabbit-company/logger";
export type * from "@rabbit-company/logger";
