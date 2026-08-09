/**
 * @file Shared outbound-network guard for HTTP tools and remote MCP traffic.
 *
 * Classifies literal and resolved IPv4, IPv6, and IPv4-mapped addresses,
 * rejects localhost and non-public ranges, blocks redirects, and installs the
 * same check into Undici's socket-time DNS lookup. The socket guard closes the
 * validation-to-connect race used by DNS rebinding attacks. `allow_internal`
 * is the sole explicit escape hatch and is applied by the declaring capability.
 */

import { lookup as lookupCallback } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

/**
 * Creates a socket-time DNS resolver that rejects any non-public result.
 * @param resolve Host resolver invoked by the HTTP socket connector.
 * @returns A resolver that rejects every result set containing a private address.
 */
export function createGuardedLookup(resolve: LookupFunction): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, options, (error, address, family) => {
      if (error) {
        callback(error, address, family);
        return;
      }
      const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
      const blocked = addresses.find(isPrivateAddress);
      if (!blocked) {
        callback(null, address, family);
        return;
      }
      const refusal = Object.assign(
        new Error(`refusing connection to private/loopback address '${blocked}'`),
        { code: "EACCES" },
      );
      callback(refusal, address, family);
    });
  };
}

const guardedAgent = new Agent({ connect: { lookup: createGuardedLookup(lookupCallback) } });

function mappedIpv4(ip: string): string | null {
  const dotted = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Determines whether private address.
 * @param ip A literal IPv4 or IPv6 address.
 * @returns Whether it belongs to a non-public address range.
 */
export function isPrivateAddress(ip: string): boolean {
  const candidate = mappedIpv4(ip.toLowerCase()) ?? ip.toLowerCase();
  if (isIP(candidate) === 4) {
    const [a, b, c] = candidate.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  return (
    candidate === "::1" ||
    candidate === "::" ||
    candidate.startsWith("100:") ||
    candidate.startsWith("2001:2:") ||
    candidate.startsWith("2001:db8:") ||
    /^f[cd]/.test(candidate) ||
    /^fe[89ab]/.test(candidate) ||
    candidate.startsWith("ff")
  );
}

/**
 * Determines whether literal loopback.
 * @param hostname A URL hostname without a port.
 * @returns Whether it is an explicit loopback or localhost name.
 */
export function isLiteralLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    (isIP(host) === 4 && host.startsWith("127.")) ||
    host === "::1"
  );
}

/**
 * Returns a refusal message when any resolved address is private, otherwise null.
 * @param hostname A literal address or DNS hostname.
 * @returns A refusal message when any resolved address is private, otherwise null.
 */
export async function vetEgressHost(hostname: string): Promise<string | null> {
  const refusal = (detail: string) =>
    `refusing to call private/loopback address ${detail} (set allow_internal: true to permit)`;
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost" || bare.endsWith(".localhost")) return refusal(`'${hostname}'`);
  if (isIP(bare)) return isPrivateAddress(bare) ? refusal(`'${hostname}'`) : null;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    return `cannot resolve host '${hostname}'`;
  }
  const bad = addresses.find((a) => isPrivateAddress(a.address));
  return bad ? refusal(`'${bad.address}' (resolved from '${hostname}')`) : null;
}

/**
 * Returns a non-redirect response from an allowed destination.
 * @param input Fetch request target.
 * @param init Fetch request options.
 * @param allowInternal Whether this declaration explicitly grants private-network access.
 * @returns A non-redirect response from an allowed destination.
 */
export async function guardedFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  allowInternal: boolean,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (!allowInternal) {
    const refusal = await vetEgressHost(url.hostname);
    if (refusal) throw new Error(refusal);
  }
  const response = await fetch(input, {
    ...init,
    dispatcher: allowInternal ? undefined : guardedAgent,
    redirect: "manual",
  } as RequestInit & { dispatcher?: Agent });
  if (response.status >= 300 && response.status < 400)
    throw new Error(`redirect to '${response.headers.get("location") ?? "?"}' blocked`);
  return response;
}
