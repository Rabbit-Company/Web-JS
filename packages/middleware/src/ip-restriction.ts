import type { Context, Middleware } from "@rabbit-company/web";

/**
 * IP restriction middleware configuration
 */
export interface IpRestrictionConfig {
	/**
	 * Mode of operation
	 * - "whitelist": Only allow IPs in the list
	 * - "blacklist": Block IPs in the list
	 */
	mode: "whitelist" | "blacklist";

	/**
	 * List of IP addresses or CIDR ranges
	 * Supports both IPv4 and IPv6
	 * @example ["192.168.1.1", "10.0.0.0/8", "::1", "2001:db8::/32"]
	 */
	ips: string[];

	/**
	 * Custom message when access is denied
	 * Can be a string or a function that returns a string
	 * @default "Access denied"
	 */
	message?: string | ((ip: string) => string);

	/**
	 * HTTP status code when access is denied
	 * @default 403
	 */
	statusCode?: number;

	/**
	 * Function to skip IP restriction for certain requests
	 * @param ctx - Request context
	 * @returns True to skip restriction
	 */
	skip?: (ctx: Context) => boolean | Promise<boolean>;

	/**
	 * Whether to log denied requests
	 * @default false
	 */
	logDenied?: boolean;

	/**
	 * Custom logger function
	 * @default console.warn
	 */
	logger?: (message: string, ip: string, ctx: Context) => void;

	/**
	 * Whether to set a custom header with the restriction result
	 * Useful for debugging
	 * @default false
	 */
	setHeader?: boolean;

	/**
	 * Header name for restriction result
	 * @default "X-IP-Restriction"
	 */
	headerName?: string;
}

/**
 * Resolved configuration with all required fields
 * @internal
 */
interface ResolvedIpRestrictionConfig extends Required<IpRestrictionConfig> {
	message: string | ((ip: string) => string);
}

/**
 * Dynamic IP restriction instance
 */
export interface DynamicIpRestriction {
	/**
	 * The middleware function to use in your app
	 */
	middleware: Middleware;

	/**
	 * Update the configuration
	 * @param newConfig - Partial configuration to merge
	 */
	update(newConfig: Partial<IpRestrictionConfig>): void;

	/**
	 * Add an IP address to the list
	 * @param ip - IP address or CIDR range to add
	 */
	addIp(ip: string): void;

	/**
	 * Remove an IP address from the list
	 * @param ip - IP address or CIDR range to remove
	 */
	removeIp(ip: string): void;

	/**
	 * Get the current configuration
	 * @returns A copy of the current configuration
	 */
	getConfig(): IpRestrictionConfig;
}

/**
 * IP restriction middleware factory
 *
 * Creates middleware that allows or blocks requests based on IP address.
 * Supports both whitelist and blacklist modes with CIDR notation.
 *
 * Note: This middleware uses ctx.clientIp which is automatically set by the server.
 * If you're behind a proxy (Cloudflare, nginx, etc.), use ip-extract middleware first
 * to properly extract the real client IP from headers.
 *
 * @param config - IP restriction configuration
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * // Direct connection (no proxy) - ctx.clientIp is already available
 * app.use(ipRestriction({
 *   mode: "whitelist",
 *   ips: ["192.168.1.0/24", "10.0.0.1"],
 *   message: "Access restricted to internal network"
 * }));
 *
 * // Behind a proxy - use ipExtract first
 * app.use(ipExtract("cloudflare"));
 * app.use(ipRestriction({
 *   mode: "blacklist",
 *   ips: ["192.168.1.100", "10.0.0.0/16"],
 *   logDenied: true
 * }));
 *
 * // Skip for authenticated users
 * app.use(ipRestriction({
 *   mode: "blacklist",
 *   ips: suspiciousIps,
 *   skip: async (ctx) => {
 *     const user = ctx.get("user");
 *     return user?.role === "admin";
 *   }
 * }));
 *
 * // Dynamic message based on IP
 * app.use("/admin", ipRestriction({
 *   mode: "whitelist",
 *   ips: ["10.0.0.0/8"],
 *   message: (ip) => `Access denied for ${ip}. Admin panel is restricted to internal network.`
 * }));
 * ```
 */
export function ipRestriction(config: IpRestrictionConfig): Middleware {
	// Apply defaults with explicit type
	const options: ResolvedIpRestrictionConfig = {
		statusCode: 403,
		message: "Access denied",
		logDenied: false,
		logger: console.warn,
		setHeader: false,
		headerName: "X-IP-Restriction",
		skip: undefined,
		...config,
	} as ResolvedIpRestrictionConfig;

	// Pre-process IPs for faster lookup
	const processedIps = processIpList(options.ips);

	const middleware: Middleware = async (ctx: Context, next: () => Promise<void | Response>): Promise<void | Response> => {
		// Skip if configured
		if (options.skip && (await options.skip(ctx))) {
			return next();
		}

		// Get client IP from context (automatically set by the server)
		const clientIp = ctx.clientIp;

		// No IP found - deny by default
		if (!clientIp) {
			if (options.logDenied) {
				options.logger("IP restriction: No client IP found", "unknown", ctx);
			}

			const message = typeof options.message === "function" ? options.message("unknown") : options.message;

			return ctx.text(message, options.statusCode);
		}

		// Normalize IP
		const normalizedIp = normalizeIp(clientIp);

		// Check if IP is in the list
		const isInList = isIpInList(normalizedIp, processedIps);

		// Determine if access should be allowed
		const shouldAllow = options.mode === "whitelist" ? isInList : !isInList;

		// Set debug header if configured
		if (options.setHeader) {
			ctx.header(options.headerName, shouldAllow ? "allowed" : "denied");
		}

		// Deny access if not allowed
		if (!shouldAllow) {
			if (options.logDenied) {
				const action = options.mode === "whitelist" ? "not in whitelist" : "in blacklist";
				options.logger(`IP restriction: ${normalizedIp} ${action}`, normalizedIp, ctx);
			}

			const message = typeof options.message === "function" ? options.message(normalizedIp) : options.message;

			return ctx.text(message, options.statusCode);
		}

		// Continue to next middleware
		return next();
	};

	return middleware;
}

/**
 * Helper function to create IP restriction for common scenarios
 */
export const ipRestrictionPresets = {
	/**
	 * Allow only localhost connections
	 * @returns IP restriction config for localhost only
	 */
	localhostOnly: (): IpRestrictionConfig => ({
		mode: "whitelist",
		ips: ["127.0.0.1", "::1"],
		message: "Access restricted to localhost",
	}),

	/**
	 * Allow only private network IPs (RFC 1918)
	 * @returns IP restriction config for private networks
	 */
	privateNetworkOnly: (): IpRestrictionConfig => ({
		mode: "whitelist",
		ips: [
			"10.0.0.0/8", // Class A private
			"172.16.0.0/12", // Class B private
			"192.168.0.0/16", // Class C private
			"127.0.0.1", // Localhost
			"::1", // IPv6 localhost
			"fc00::/7", // IPv6 private
		],
		message: "Access restricted to private network",
	}),
} as const;

/**
 * Processed IP entry for efficient lookup
 * @internal
 */
interface ProcessedIp {
	type: "single" | "cidr";
	value: string;
	cidr?: {
		network: string;
		prefixLength: number;
		version: 4 | 6;
	};
}

/**
 * Process IP list for efficient lookup
 * @param ips - List of IP addresses or CIDR ranges
 * @returns Processed IP list
 * @internal
 */
function processIpList(ips: string[]): ProcessedIp[] {
	return ips.map((ip: string): ProcessedIp => {
		const trimmed = ip.trim();

		if (trimmed.includes("/")) {
			// CIDR notation
			const [network, prefix] = trimmed.split("/");
			const prefixLength = parseInt(prefix, 10);
			const version: 4 | 6 = isIpv4(network) ? 4 : 6;

			return {
				type: "cidr",
				value: trimmed,
				cidr: {
					network: normalizeIp(network),
					prefixLength,
					version,
				},
			};
		} else {
			// Single IP
			return {
				type: "single",
				value: normalizeIp(trimmed),
			};
		}
	});
}

/**
 * Check if IP is in the processed list
 * @param ip - Normalized IP address
 * @param list - Processed IP list
 * @returns True if IP is in the list
 * @internal
 */
function isIpInList(ip: string, list: ProcessedIp[]): boolean {
	for (const item of list) {
		if (item.type === "single") {
			if (ip === item.value) {
				return true;
			}
		} else if (item.cidr) {
			if (isIpInCidr(ip, item.cidr.network, item.cidr.prefixLength, item.cidr.version)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Normalize IP address
 * @param ip - IP address to normalize
 * @returns Normalized IP address
 * @internal
 */
function normalizeIp(ip: string): string {
	if (!ip) return ip;
	ip = ip.trim();

	// Remove IPv6 brackets
	if (ip.startsWith("[") && ip.includes("]")) {
		ip = ip.substring(1, ip.indexOf("]"));
	}

	// Remove port from IPv4
	if (isIpv4(ip.split(":")[0]) && ip.includes(":")) {
		ip = ip.split(":")[0];
	}

	// Remove IPv6 zone identifier
	if (ip.includes("%")) {
		ip = ip.split("%")[0];
	}

	// Remove IPv4-mapped IPv6 prefix
	if (ip.startsWith("::ffff:")) {
		const ipv4 = ip.substring(7);
		if (isIpv4(ipv4)) {
			return ipv4;
		}
	}

	return ip.toLowerCase();
}

/**
 * Check if string is valid IPv4
 * @param ip - String to check
 * @returns True if valid IPv4
 * @internal
 */
function isIpv4(ip: string): boolean {
	const parts = ip.split(".");
	if (parts.length !== 4) return false;

	return parts.every((part: string): boolean => {
		const num = parseInt(part, 10);
		return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString();
	});
}

/**
 * Check if string is valid IPv6
 * @param ip - String to check
 * @returns True if valid IPv6
 * @internal
 */
function isIpv6(ip: string): boolean {
	// Remove zone identifier
	const cleanIp = ip.split("%")[0];

	// Basic IPv6 validation regex
	const ipv6Regex =
		/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

	return ipv6Regex.test(cleanIp);
}

/**
 * Check if IP is in CIDR range
 * @param ip - IP address to check
 * @param network - Network address
 * @param prefixLength - CIDR prefix length
 * @param version - IP version (4 or 6)
 * @returns True if IP is in range
 * @internal
 */
function isIpInCidr(ip: string, network: string, prefixLength: number, version: 4 | 6): boolean {
	if (version === 4) {
		if (!isIpv4(ip)) return false;
		return isIpv4InCidr(ip, network, prefixLength);
	} else {
		if (!isIpv6(ip)) return false;
		return isIpv6InCidr(ip, network, prefixLength);
	}
}

/**
 * Check if IPv4 is in CIDR range
 * @param ip - IPv4 address
 * @param network - Network address
 * @param prefixLength - CIDR prefix length
 * @returns True if IP is in range
 * @internal
 */
function isIpv4InCidr(ip: string, network: string, prefixLength: number): boolean {
	const ipNum = ipv4ToNumber(ip);
	const networkNum = ipv4ToNumber(network);
	const mask = (0xffffffff << (32 - prefixLength)) >>> 0;

	return (ipNum & mask) === (networkNum & mask);
}

/**
 * Convert IPv4 to number
 * @param ip - IPv4 address
 * @returns Numeric representation
 * @internal
 */
function ipv4ToNumber(ip: string): number {
	const parts = ip.split(".").map((p: string): number => parseInt(p, 10));
	return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if IPv6 is in CIDR range (simplified)
 * @param ip - IPv6 address
 * @param network - Network address
 * @param prefixLength - CIDR prefix length
 * @returns True if IP is in range
 * @internal
 */
function isIpv6InCidr(ip: string, network: string, prefixLength: number): boolean {
	// Expand IPv6 addresses
	const expandedIp = expandIpv6(ip);
	const expandedNetwork = expandIpv6(network);

	// Compare bit by bit up to prefix length
	const bitsToCompare = Math.floor(prefixLength / 4);

	for (let i = 0; i < bitsToCompare; i++) {
		if (expandedIp[i] !== expandedNetwork[i]) {
			return false;
		}
	}

	// Handle remaining bits
	const remainingBits = prefixLength % 4;
	if (remainingBits > 0) {
		const index = bitsToCompare;
		const mask = (0xf << (4 - remainingBits)) & 0xf;
		const ipNibble = parseInt(expandedIp[index], 16);
		const networkNibble = parseInt(expandedNetwork[index], 16);

		if ((ipNibble & mask) !== (networkNibble & mask)) {
			return false;
		}
	}

	return true;
}

/**
 * Expand IPv6 address to full form
 * @param ip - IPv6 address
 * @returns Expanded IPv6 address
 * @internal
 */
function expandIpv6(ip: string): string {
	// Remove zone identifier
	ip = ip.split("%")[0];

	// Handle IPv4-mapped IPv6
	if (ip.includes(".")) {
		const lastColon = ip.lastIndexOf(":");
		const ipv4Part = ip.substring(lastColon + 1);
		const ipv6Part = ip.substring(0, lastColon);

		// Convert IPv4 to hex
		const ipv4Parts = ipv4Part.split(".").map((p: string): number => parseInt(p, 10));
		const ipv4Hex = ((ipv4Parts[0] << 8) | ipv4Parts[1]).toString(16).padStart(4, "0") + ((ipv4Parts[2] << 8) | ipv4Parts[3]).toString(16).padStart(4, "0");

		ip = ipv6Part + ":" + ipv4Hex.substring(0, 4) + ":" + ipv4Hex.substring(4);
	}

	// Split into groups
	let groups = ip.split(":");

	// Find :: and expand it
	const emptyIndex = groups.indexOf("");
	if (emptyIndex !== -1) {
		// Remove empty strings
		groups = groups.filter((g: string): boolean => g !== "");

		// Calculate how many zeros to insert
		const missingGroups = 8 - groups.length;
		const zeros: string[] = new Array(missingGroups).fill("0000");

		// Insert zeros at the correct position
		if (emptyIndex === 0) {
			groups = zeros.concat(groups);
		} else if (emptyIndex === groups.length) {
			groups = groups.concat(zeros);
		} else {
			groups = groups.slice(0, emptyIndex).concat(zeros).concat(groups.slice(emptyIndex));
		}
	}

	// Pad each group to 4 characters
	groups = groups.map((g: string): string => g.padStart(4, "0"));

	// Join back together
	return groups.join("").toLowerCase();
}

/**
 * Create a dynamic IP restriction that can be updated
 * @param initialConfig - Initial IP restriction configuration
 * @returns Dynamic IP restriction instance
 *
 * @example
 * ```typescript
 * const restriction = createDynamicIpRestriction({
 *   mode: "blacklist",
 *   ips: []
 * });
 *
 * app.use(restriction.middleware);
 *
 * // Later, add IPs dynamically
 * restriction.addIp("192.168.1.100");
 *
 * // Remove IPs
 * restriction.removeIp("192.168.1.100");
 *
 * // Update entire config
 * restriction.update({ mode: "whitelist" });
 * ```
 */
export function createDynamicIpRestriction(initialConfig: IpRestrictionConfig): DynamicIpRestriction {
	let config: IpRestrictionConfig = { ...initialConfig };
	let middleware: Middleware = ipRestriction(config);

	return {
		middleware: (ctx: Context, next: () => Promise<void | Response>): Response | Promise<void | Response> => middleware(ctx, next),

		update(newConfig: Partial<IpRestrictionConfig>): void {
			config = { ...config, ...newConfig };
			middleware = ipRestriction(config);
		},

		addIp(ip: string): void {
			config.ips = [...config.ips, ip];
			middleware = ipRestriction(config);
		},

		removeIp(ip: string): void {
			config.ips = config.ips.filter((i: string): boolean => i !== ip);
			middleware = ipRestriction(config);
		},

		getConfig(): IpRestrictionConfig {
			return { ...config };
		},
	};
}
