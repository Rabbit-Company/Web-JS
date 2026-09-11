/**
 * CIDR helpers shared by the ip-extract and ip-restriction middleware.
 * Addresses must already be validated and normalized (no brackets, ports or zone identifiers).
 *
 * @internal
 */

/**
 * Check if an IPv4 address is in a CIDR range
 * @param ip - IPv4 address
 * @param network - Network address
 * @param prefixLength - CIDR prefix length (0-32)
 * @returns True if IP is in range
 * @internal
 */
export function isIpv4InCidr(ip: string, network: string, prefixLength: number): boolean {
	if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) return false;

	// A shift by 32 is a no-op in JavaScript, so /0 needs its own mask
	const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;

	return (ipv4ToNumber(ip) & mask) >>> 0 === (ipv4ToNumber(network) & mask) >>> 0;
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
 * Check if an IPv6 address is in a CIDR range
 * @param ip - IPv6 address
 * @param network - Network address
 * @param prefixLength - CIDR prefix length (0-128)
 * @returns True if IP is in range
 * @internal
 */
export function isIpv6InCidr(ip: string, network: string, prefixLength: number): boolean {
	if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 128) return false;

	// Expand IPv6 addresses
	const expandedIp = expandIpv6(ip);
	const expandedNetwork = expandIpv6(network);

	// Compare whole hex digits (4 bits each) up to the prefix length
	const nibblesToCompare = Math.floor(prefixLength / 4);

	for (let i = 0; i < nibblesToCompare; i++) {
		if (expandedIp[i] !== expandedNetwork[i]) {
			return false;
		}
	}

	// Handle remaining bits
	const remainingBits = prefixLength % 4;
	if (remainingBits > 0) {
		const index = nibblesToCompare;
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
 * Expand IPv6 address to its full 32 hex digit form
 * @param ip - IPv6 address
 * @returns Expanded IPv6 address
 * @internal
 */
export function expandIpv6(ip: string): string {
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
