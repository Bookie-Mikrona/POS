import net from "node:net";

type ParsedIp = {
  version: 4 | 6;
  value: bigint;
  bits: 32 | 128;
};

function ipv4ToBigInt(address: string): bigint | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function ipv6ToBigInt(rawAddress: string): bigint | null {
  let address = rawAddress.toLowerCase().split("%", 1)[0] ?? "";
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = ipv4ToBigInt(address.slice(lastColon + 1));
    if (ipv4 === null) return null;
    address = `${address.slice(0, lastColon)}:${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return value;
}

/** Express lahko IPv4 naslov vrne kot IPv4-mapped IPv6. */
export function normalizeClientIp(rawAddress: string): string {
  const address = rawAddress.trim().replace(/^\[|\]$/g, "").split("%", 1)[0] ?? "";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return mapped?.[1] ?? address;
}

function parseIp(rawAddress: string): ParsedIp | null {
  const address = normalizeClientIp(rawAddress);
  const version = net.isIP(address);
  if (version === 4) {
    const value = ipv4ToBigInt(address);
    return value === null ? null : { version: 4, value, bits: 32 };
  }
  if (version === 6) {
    const value = ipv6ToBigInt(address);
    return value === null ? null : { version: 6, value, bits: 128 };
  }
  return null;
}

function parseNetwork(rawNetwork: string): { ip: ParsedIp; prefix: number } | null {
  const value = rawNetwork.trim();
  if (!value) return null;
  const parts = value.split("/");
  if (parts.length > 2) return null;
  const ip = parseIp(parts[0] ?? "");
  if (!ip) return null;
  const prefix = parts.length === 1 ? ip.bits : Number(parts[1]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > ip.bits) return null;
  return { ip, prefix };
}

function matchesPrefix(value: bigint, base: bigint, bits: number, prefix: number): boolean {
  const shift = BigInt(bits - prefix);
  return (value >> shift) === (base >> shift);
}

function isGloballyRoutable(ip: ParsedIp): boolean {
  if (ip.version === 4) {
    const reserved = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ] as const;
    return !reserved.some(([base, prefix]) => {
      const baseValue = ipv4ToBigInt(base);
      return baseValue !== null && matchesPrefix(ip.value, baseValue, 32, prefix);
    });
  }

  // Trenutni globalni unicast IPv6 prostor je 2000::/3. Dokumentacijski
  // 2001:db8::/32 je znotraj njega, vendar ni javno usmerljiv.
  const globalUnicastBase = ipv6ToBigInt("2000::");
  const documentationBase = ipv6ToBigInt("2001:db8::");
  return globalUnicastBase !== null
    && matchesPrefix(ip.value, globalUnicastBase, 128, 3)
    && documentationBase !== null
    && !matchesPrefix(ip.value, documentationBase, 128, 32);
}

export function isValidIpNetwork(network: string): boolean {
  const parsed = parseNetwork(network);
  if (!parsed || !isGloballyRoutable(parsed.ip)) return false;
  // Omejimo posledice napačne nastavitve: za lokal je primeren točen WAN IP
  // ali majhen obseg ponudnika, nikoli celoten internet ali zelo širok blok.
  return parsed.ip.version === 4 ? parsed.prefix >= 24 : parsed.prefix >= 48;
}

export function ipMatchesNetwork(clientIp: string, network: string): boolean {
  const ip = parseIp(clientIp);
  const parsedNetwork = parseNetwork(network);
  if (!ip || !parsedNetwork || ip.version !== parsedNetwork.ip.version) return false;
  const shift = BigInt(ip.bits - parsedNetwork.prefix);
  return (ip.value >> shift) === (parsedNetwork.ip.value >> shift);
}

export function ipMatchesAnyNetwork(clientIp: string, networks: readonly string[]): boolean {
  return networks.some((network) => isValidIpNetwork(network) && ipMatchesNetwork(clientIp, network));
}

export function normalizeIpNetworks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const networks = [...new Set(value.map((entry) => typeof entry === "string" ? entry.trim() : ""))]
    .filter(Boolean);
  if (networks.some((network) => !isValidIpNetwork(network))) return null;
  return networks;
}