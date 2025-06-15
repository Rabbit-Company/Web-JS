import type { Context, Middleware } from "@rabbit-company/web";

/**
 * Options to configure the body limit middleware behavior.
 */
export interface BodyLimitOptions<T extends Record<string, unknown>, B extends Record<string, unknown>> {
	/**
	 * Maximum allowed size for the request body.
	 * Can be a number (in bytes) or a string with units (e.g., "1mb", "500kb").
	 * Default: "1mb"
	 */
	maxSize?: number | string;

	/**
	 * Whether to include the size of the headers in the limit calculation.
	 * Default: false
	 */
	includeHeaders?: boolean;

	/**
	 * Custom error message to return when the body size exceeds the limit.
	 * Can be a string or a function that returns a string.
	 */
	message?: string | ((size: number, limit: number) => string);

	/**
	 * The HTTP status code to return when the body size exceeds the limit.
	 * Default: 413 (Payload Too Large)
	 */
	statusCode?: number;

	/**
	 * Content types to apply the limit to.
	 * If not specified, applies to all content types.
	 */
	contentTypes?: string[];

	/**
	 * Whether to skip the limit check for specific routes.
	 * Function receives the context and returns true to skip the check.
	 */
	skip?: (ctx: Context<T, B>) => boolean | Promise<boolean>;
}

/**
 * Body limit middleware to restrict the size of incoming request bodies.
 *
 * @template T - The context's data type.
 * @param {BodyLimitOptions<T, B>} [options={}] - Configuration options for body limit behavior.
 * @returns {Middleware<T, B>} - A middleware function for handling body size limits.
 */
export function bodyLimit<T extends Record<string, unknown> = Record<string, unknown>, B extends Record<string, unknown> = Record<string, unknown>>(
	options: BodyLimitOptions<T, B> = {}
): Middleware<T, B> {
	const opts: BodyLimitOptions<T, B> = {
		maxSize: "1mb",
		includeHeaders: false,
		statusCode: 413,
		...options,
	};

	const limit = parseSize(opts.maxSize);

	return async (ctx: Context<T, B>, next) => {
		// Check if we should skip this request
		if (opts.skip && (await opts.skip(ctx))) {
			return next();
		}

		// Check content type if specified
		if (opts.contentTypes?.length) {
			const contentType = ctx.req.headers.get("Content-Type") || "";
			const matches = opts.contentTypes.some((type) => contentType.toLowerCase().includes(type.toLowerCase()));
			if (!matches) {
				return next();
			}
		}

		// Get content length
		const contentLength = getContentLength(ctx, opts.includeHeaders);

		if (contentLength !== null && contentLength > limit) {
			const message = getErrorMessage(contentLength, limit, opts.message);
			return ctx.text(message, opts.statusCode || 413);
		}

		// For streaming bodies, we need to check while reading
		if (contentLength === null && ctx.req.body) {
			try {
				const reader = ctx.req.body.getReader();
				let totalSize = 0;
				const chunks: Uint8Array[] = [];

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					totalSize += value.length;
					if (totalSize > limit) {
						reader.cancel();
						const message = getErrorMessage(totalSize, limit, opts.message);
						return ctx.text(message, opts.statusCode || 413);
					}
					chunks.push(value);
				}

				// Reconstruct the body for downstream middleware/handlers
				const newBody = new ReadableStream({
					start(controller) {
						for (const chunk of chunks) {
							controller.enqueue(chunk);
						}
						controller.close();
					},
				});

				// Create a new request with the reconstructed body
				const newRequest = new Request(ctx.req.url, {
					method: ctx.req.method,
					headers: ctx.req.headers,
					body: newBody,
					// @ts-ignore - some properties might not be standard
					duplex: "half",
				});

				// Replace the request in context
				Object.defineProperty(ctx, "req", {
					value: newRequest,
					writable: false,
					configurable: true,
				});
			} catch (error) {
				// If there's an error reading the body, let it pass through
				console.error("Error checking body size:", error);
			}
		}

		return next();
	};
}

/**
 * Parses a size string or number into bytes.
 *
 * @param {number | string | undefined} size - The size to parse.
 * @returns {number} - The size in bytes.
 */
function parseSize(size?: number | string): number {
	if (typeof size === "number") return size;
	if (!size || typeof size !== "string") return 1048576; // 1MB default

	const units: Record<string, number> = {
		b: 1,
		kb: 1024,
		mb: 1048576,
		gb: 1073741824,
		tb: 1099511627776,
	};

	const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
	if (!match) {
		throw new Error(`Invalid size format: ${size}`);
	}

	const num = parseFloat(match[1]);
	const unit = match[2] || "b";

	return Math.floor(num * (units[unit] || 1));
}

/**
 * Gets the content length from the request headers.
 *
 * @template T - The context's data type.
 * @param {Context<T, B>} ctx - The request context.
 * @param {boolean} [includeHeaders=false] - Whether to include header size.
 * @returns {number | null} - The content length in bytes, or null if not available.
 */
function getContentLength<T extends Record<string, unknown>, B extends Record<string, unknown>>(
	ctx: Context<T, B>,
	includeHeaders: boolean = false
): number | null {
	const contentLength = ctx.req.headers.get("Content-Length");
	let size = contentLength ? parseInt(contentLength, 10) : null;

	if (size === null || isNaN(size)) return null;

	if (includeHeaders) {
		// Estimate header size
		let headerSize = 0;
		ctx.req.headers.forEach((value, key) => {
			headerSize += key.length + value.length + 4; // ": " and "\r\n"
		});
		headerSize += ctx.req.method.length + ctx.req.url.length + 12; // "HTTP/1.1\r\n\r\n"
		size += headerSize;
	}

	return size;
}

/**
 * Generates an error message for when the body size exceeds the limit.
 *
 * @param {number} size - The actual size of the request body.
 * @param {number} limit - The maximum allowed size.
 * @param {BodyLimitOptions['message']} [customMessage] - Custom message option.
 * @returns {string} - The error message.
 */
function getErrorMessage(size: number, limit: number, customMessage?: string | ((size: number, limit: number) => string)): string {
	if (typeof customMessage === "function") {
		return customMessage(size, limit);
	}
	if (typeof customMessage === "string") {
		return customMessage;
	}
	return `Request body too large. Received ${formatSize(size)} but limit is ${formatSize(limit)}.`;
}

/**
 * Formats a size in bytes to a human-readable string.
 *
 * @param {number} bytes - The size in bytes.
 * @returns {string} - The formatted size string.
 */
function formatSize(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(unitIndex > 0 ? 2 : 0)}${units[unitIndex]}`;
}
