import type { Context, Middleware } from "../../../core/src";

/**
 * Secure IP extraction configuration
 */
export interface IpExtractionConfig {
	/**
	 * Whether to trust proxy headers at all.
	 * Set to false if your app receives direct connections.
	 * @default false
	 */
	trustProxy: boolean;

	/**
	 * List of trusted proxy IPs or CIDR ranges.
	 * Only trust headers if request comes from these IPs.
	 * Supports IPv4 and IPv6 CIDR notation.
	 * @example ['10.0.0.0/8', '172.16.0.0/12', '192.168.1.1']
	 */
	trustedProxies?: string[];

	/**
	 * Which headers to trust and in what order.
	 * Common options: ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip']
	 *
	 * WARNING: Only include headers that your infrastructure actually sets!
	 * @default ['x-forwarded-for', 'x-real-ip']
	 */
	trustedHeaders?: string[];

	/**
	 * Maximum number of proxies to trust in X-Forwarded-For chain.
	 * Prevents clients from injecting long chains.
	 * @default 5
	 */
	maxProxyChain?: number;

	/**
	 * Cloud provider mode for automatic secure configuration
	 */
	cloudProvider?: "aws" | "cloudflare" | "gcp" | "azure" | "vercel" | "custom";

	/**
	 * Whether to log warnings for suspicious activity
	 * @default false
	 */
	logWarnings?: boolean;
}

/**
 * Default secure configurations for common cloud providers
 */
const CLOUD_CONFIGS: Record<string, Partial<IpExtractionConfig>> = {
	aws: {
		trustProxy: true,
		trustedHeaders: ["x-forwarded-for"],
		maxProxyChain: 2,
		// AWS ALB/ELB adds the real client IP as the first entry
	},
	cloudflare: {
		trustProxy: true,
		trustedHeaders: ["cf-connecting-ip", "x-forwarded-for"],
		// Cloudflare IP ranges (should be fetched dynamically in production)
		// See: https://www.cloudflare.com/ips/
		trustedProxies: [
			// IPv4
			"173.245.48.0/20",
			"103.21.244.0/22",
			"103.22.200.0/22",
			"103.31.4.0/22",
			"141.101.64.0/18",
			"108.162.192.0/18",
			"190.93.240.0/20",
			"188.114.96.0/20",
			"197.234.240.0/22",
			"198.41.128.0/17",
			"162.158.0.0/15",
			"104.16.0.0/13",
			"104.24.0.0/14",
			"172.64.0.0/13",
			"131.0.72.0/22",
			// IPv6
			"2400:cb00::/32",
			"2606:4700::/32",
			"2803:f800::/32",
			"2405:b500::/32",
			"2405:8100::/32",
			"2a06:98c0::/29",
			"2c0f:f248::/32",
		],
	},
	gcp: {
		trustProxy: true,
		trustedHeaders: ["x-forwarded-for", "x-cloud-trace-context"],
		maxProxyChain: 2,
		// GCP Load Balancer IPs
		trustedProxies: ["35.191.0.0/16", "130.211.0.0/22"],
	},
	azure: {
		trustProxy: true,
		trustedHeaders: ["x-forwarded-for", "x-original-forwarded-for", "x-azure-clientip"],
		maxProxyChain: 2,
	},
	vercel: {
		trustProxy: true,
		trustedHeaders: ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for"],
		maxProxyChain: 1,
	},
};

/**
 * IP extraction middleware that populates ctx.clientIp
 *
 * @example
 * ```typescript
 * // Using presets
 * app.use(ipExtract("cloudflare"));
 *
 * // Using configuration
 * app.use(ipExtract({
 *   trustProxy: true,
 *   trustedProxies: ["10.0.0.0/8"],
 *   trustedHeaders: ["x-real-ip"]
 * }));
 *
 * // Direct connection
 * app.use(ipExtract("direct"));
 * ```
 */
export function ipExtract<T extends Record<string, unknown> = Record<string, unknown>>(
	config: IpExtractionConfig | keyof typeof IP_EXTRACTION_PRESETS = "direct"
): Middleware<T> {
	// Handle preset strings
	const resolvedConfig: IpExtractionConfig = typeof config === "string" ? IP_EXTRACTION_PRESETS[config] : config;

	// Apply defaults
	const finalConfig: Required<IpExtractionConfig> = {
		trustedProxies: [],
		trustedHeaders: ["x-forwarded-for", "x-real-ip"],
		maxProxyChain: 5,
		cloudProvider: "custom",
		logWarnings: false,
		...resolvedConfig,
	};

	// Apply cloud provider defaults
	if (finalConfig.cloudProvider !== "custom" && CLOUD_CONFIGS[finalConfig.cloudProvider]) {
		Object.assign(finalConfig, CLOUD_CONFIGS[finalConfig.cloudProvider], resolvedConfig);
	}

	// Create extractor function once
	const extractIp = createSecureIpExtractor(finalConfig);

	return async (ctx: Context<T>, next) => {
		try {
			// Extract IP and store it directly in context
			ctx.clientIp = extractIp(ctx);
		} catch (error) {
			// Log error but don't fail the request
			if (finalConfig.logWarnings) {
				console.error("[ipExtract] Failed to extract client IP:", error);
			}
		}

		// Continue to next middleware
		await next();
	};
}

/**
 * Helper to get client IP from context (for use in other middlewares)
 * This provides backward compatibility and type safety
 */
export function getClientIp<T extends Record<string, unknown>>(ctx: Context<T>): string | undefined {
	return ctx.clientIp;
}

/**
 * Securely extract client IP based on configuration
 */
function secureExtractClientIp<T extends Record<string, unknown>>(ctx: Context<T>, config: Required<IpExtractionConfig>): string | undefined {
	// 1. If not trusting proxies, only use direct connection IP
	if (!config.trustProxy) {
		return ctx.clientIp;
	}

	// 2. Verify the request comes from a trusted proxy (if configured)
	if (config.trustedProxies.length > 0 && ctx.clientIp) {
		if (!isIpTrusted(ctx.clientIp, config.trustedProxies)) {
			// Request didn't come from trusted proxy, use direct IP
			if (config.logWarnings) {
				console.warn(`[ipExtract] Untrusted proxy attempt from ${ctx.clientIp}`);
			}
			return ctx.clientIp;
		}
	}

	// 3. Check trusted headers in order
	const headers = ctx.req.headers;

	for (const headerName of config.trustedHeaders) {
		const headerValue = headers.get(headerName);
		if (!headerValue) continue;

		// Special handling for X-Forwarded-For
		if (headerName.toLowerCase() === "x-forwarded-for") {
			const ip = parseXForwardedFor(headerValue, config.maxProxyChain, config.logWarnings);
			if (ip) return normalizeIp(ip);
		} else {
			// Single IP headers
			const ip = headerValue.trim();
			if (isValidIp(ip)) return normalizeIp(ip);
		}
	}

	// 4. Fall back to direct connection
	return ctx.clientIp;
}

/**
 * Parse X-Forwarded-For header securely
 */
function parseXForwardedFor(value: string, maxChain: number, logWarnings: boolean): string | undefined {
	const ips = value
		.split(",")
		.map((ip) => ip.trim())
		.filter(Boolean);

	// Prevent overly long chains (potential attack)
	if (ips.length > maxChain) {
		if (logWarnings) {
			console.warn(`[ipExtract] X-Forwarded-For chain too long: ${ips.length} > ${maxChain}`);
		}
		// Still try to get the first IP
		const firstIp = ips[0];
		if (isValidIp(firstIp)) {
			return firstIp;
		}
		return undefined;
	}

	// The first IP should be the original client
	// (assuming proxies are configured correctly)
	for (const ip of ips) {
		if (isValidIp(ip)) {
			return ip;
		}
	}

	return undefined;
}

/**
 * Check if IP is in trusted list (supports CIDR notation)
 */
function isIpTrusted(ip: string, trustedList: string[]): boolean {
	const normalizedIp = normalizeIp(ip);

	for (const trusted of trustedList) {
		if (trusted.includes("/")) {
			// CIDR notation
			if (isIpInCidr(normalizedIp, trusted)) {
				return true;
			}
		} else if (normalizedIp === trusted) {
			return true;
		}
	}

	return false;
}

/**
 * Check if IP is within CIDR range
 */
function isIpInCidr(ip: string, cidr: string): boolean {
	const [range, prefixLength] = cidr.split("/");
	const prefix = parseInt(prefixLength, 10);

	// Handle IPv4
	if (isIpv4(ip) && isIpv4(range)) {
		const ipNum = ipv4ToNumber(ip);
		const rangeNum = ipv4ToNumber(range);
		const mask = (0xffffffff << (32 - prefix)) >>> 0;

		return (ipNum & mask) === (rangeNum & mask);
	}

	// Handle IPv6
	if (isIpv6(ip) && isIpv6(range)) {
		return isIpv6InCidr(ip, range, prefix);
	}

	return false;
}

/**
 * Convert IPv4 to number for CIDR calculation
 */
function ipv4ToNumber(ip: string): number {
	const parts = ip.split(".").map((p) => parseInt(p, 10));
	return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if IPv6 is in CIDR range (simplified)
 */
function isIpv6InCidr(ip: string, range: string, prefix: number): boolean {
	// This is a simplified check - for production use, consider a library
	// For now, we'll do a string prefix match for common cases
	if (prefix % 4 === 0) {
		const hexChars = prefix / 4;
		const ipNorm = normalizeIpv6(ip);
		const rangeNorm = normalizeIpv6(range);
		return ipNorm.substring(0, hexChars) === rangeNorm.substring(0, hexChars);
	}
	// For non-nibble-aligned prefixes, we'd need bit manipulation
	return false;
}

/**
 * Basic IPv6 normalization (expand :: notation)
 */
function normalizeIpv6(ip: string): string {
	// Remove any zone index
	const cleanIp = ip.split("%")[0];

	// This is a very basic normalization
	// For production, use a proper library
	return cleanIp.toLowerCase();
}

/**
 * Check if string is IPv4
 */
function isIpv4(ip: string): boolean {
	const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
	if (!ipv4Regex.test(ip)) return false;

	const parts = ip.split(".");
	return parts.every((part) => {
		const num = parseInt(part, 10);
		return num >= 0 && num <= 255;
	});
}

/**
 * Check if string is IPv6
 */
function isIpv6(ip: string): boolean {
	// Basic IPv6 validation
	const ipv6Regex =
		/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
	return ipv6Regex.test(ip.split("%")[0]); // Remove zone index
}

/**
 * Validate IP address format (IPv4 and IPv6)
 */
function isValidIp(ip: string): boolean {
	return isIpv4(ip) || isIpv6(ip);
}

/**
 * Normalize IP address
 */
function normalizeIp(ip: string): string {
	if (!ip) return ip;
	ip = ip.trim();

	// Remove IPv6 prefix for IPv4
	if (ip.startsWith("::ffff:")) {
		ip = ip.substring(7);
	}

	// Remove IPv4 port
	if (isIpv4(ip.split(":")[0]) && ip.includes(":")) {
		ip = ip.split(":")[0];
	}

	// Remove brackets from IPv6
	if (ip.startsWith("[") && ip.includes("]")) {
		ip = ip.substring(1, ip.indexOf("]"));
	}

	return ip;
}

/**
 * Create a secure IP extractor with your configuration
 */
function createSecureIpExtractor(config: Required<IpExtractionConfig>) {
	return <T extends Record<string, unknown>>(ctx: Context<T>) => secureExtractClientIp(ctx, config);
}

/**
 * Example configurations for common scenarios
 */
export const IP_EXTRACTION_PRESETS = {
	/**
	 * Direct connection (no proxy)
	 * Use when your application receives direct connections
	 */
	direct: {
		trustProxy: false,
		cloudProvider: undefined,
	} as IpExtractionConfig,

	/**
	 * Behind Cloudflare
	 * Automatically configures Cloudflare's IP ranges and headers
	 */
	cloudflare: {
		trustProxy: true,
		cloudProvider: "cloudflare",
	} as IpExtractionConfig,

	/**
	 * Behind AWS ALB/ELB
	 * Configures for AWS load balancers
	 */
	aws: {
		trustProxy: true,
		cloudProvider: "aws",
	} as IpExtractionConfig,

	/**
	 * Behind Google Cloud Load Balancer
	 * Configures for GCP load balancers
	 */
	gcp: {
		trustProxy: true,
		cloudProvider: "gcp",
	} as IpExtractionConfig,

	/**
	 * Behind Azure Application Gateway
	 * Configures for Azure load balancers
	 */
	azure: {
		trustProxy: true,
		cloudProvider: "azure",
	} as IpExtractionConfig,

	/**
	 * Behind Vercel
	 * Configures for Vercel's edge network
	 */
	vercel: {
		trustProxy: true,
		cloudProvider: "vercel",
	} as IpExtractionConfig,

	/**
	 * Custom nginx proxy
	 * Common configuration for nginx reverse proxy
	 */
	nginx: {
		trustProxy: true,
		trustedHeaders: ["x-real-ip", "x-forwarded-for"],
		maxProxyChain: 1,
	} as IpExtractionConfig,

	/**
	 * Development mode
	 * Trusts all headers - NEVER use in production!
	 */
	development: {
		trustProxy: true,
		trustedHeaders: ["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "x-client-ip"],
		logWarnings: true,
	} as IpExtractionConfig,
} as const;

// Export types
export type IpExtractionPreset = keyof typeof IP_EXTRACTION_PRESETS;
