import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import net from "node:net";

export const MAX_ARTICLE_REFERENCE_URLS = 3;
export const MAX_ARTICLE_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_ARTICLE_REFERENCE_TOTAL_BYTES = 8 * 1024 * 1024;

const MAX_REDIRECTS = 2;
const MAX_HTML_BYTES = 1 * 1024 * 1024;
const MAX_IMAGE_CANDIDATES = 5;
const REFERENCE_TIMEOUT_MS = 8_000;
const REFERENCE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ArticleImageReference = {
  sourceUrl: string;
  mimeType: string;
  b64Json: string;
};

export class ArticleImageReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleImageReferenceError";
  }
}

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  const ranges: Array<[number, number]> = [
    [0x00000000, 0x00ffffff], // this network / current host
    [0x0a000000, 0x0affffff], // RFC1918
    [0x64400000, 0x647fffff], // carrier-grade NAT
    [0x7f000000, 0x7fffffff], // loopback
    [0xa9fe0000, 0xa9feffff], // link-local
    [0xac100000, 0xac1fffff], // RFC1918
    [0xc0000000, 0xc00000ff], // IETF protocol assignments
    [0xc0000200, 0xc00002ff], // documentation
    [0xc0a80000, 0xc0a8ffff], // RFC1918
    [0xc6120000, 0xc613ffff], // benchmarking
    [0xc6336400, 0xc63364ff], // documentation
    [0xcb007100, 0xcb0071ff], // documentation
    [0xe0000000, 0xffffffff], // multicast and reserved
  ];
  return ranges.some(([start, end]) => value >= start && value <= end);
}

function ipv6ToBigInt(address: string): bigint {
  const withoutZone = address.split("%", 1)[0]!;
  const ipv4Suffix = withoutZone.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/)?.[1];
  const normalized = ipv4Suffix
    ? `${withoutZone.slice(0, -ipv4Suffix.length)}${ipv4ToNumber(ipv4Suffix).toString(16).padStart(8, "0").match(/.{4}/g)!.join(":")}`
    : withoutZone;
  const [left, right] = normalized.split("::");
  const leftGroups = left ? left.split(":") : [];
  const rightGroups = right ? right.split(":") : [];
  const missing = 8 - leftGroups.length - rightGroups.length;
  const groups = [...leftGroups, ...Array(Math.max(0, missing)).fill("0"), ...rightGroups];
  return BigInt(`0x${groups.map((group) => group.padStart(4, "0")).join("")}`);
}

function isInIpv6Cidr(address: string, prefixLength: number, network: bigint): boolean {
  const value = ipv6ToBigInt(address);
  const shift = BigInt(128 - prefixLength);
  return (value >> shift) === (network >> shift);
}

function isBlockedIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;
  const mappedIpv4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);

  const value = ipv6ToBigInt(address);
  if (isInIpv6Cidr(address, 96, 0x00000000000000000000ffff00000000n)) {
    const mappedIpv4 = [
      Number((value >> 24n) & 0xffn),
      Number((value >> 16n) & 0xffn),
      Number((value >> 8n) & 0xffn),
      Number(value & 0xffn),
    ].join(".");
    return isPrivateIpv4(mappedIpv4);
  }
  return (
    value === 0n || // unspecified
    value === 1n || // loopback
    isInIpv6Cidr(address, 7, 0xfc000000000000000000000000000000n) || // unique local
    isInIpv6Cidr(address, 10, 0xfe800000000000000000000000000000n) || // link-local
    isInIpv6Cidr(address, 8, 0xff000000000000000000000000000000n) || // multicast
    isInIpv6Cidr(address, 32, 0x20010db8000000000000000000000000n) // documentation
  );
}

function validateReferenceUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ArticleImageReferenceError("Referenčna povezava ni veljaven URL.");
  }
  if (url.protocol !== "https:") {
    throw new ArticleImageReferenceError("Referenčne povezave morajo uporabljati HTTPS.");
  }
  if (url.username || url.password || url.port && url.port !== "443") {
    throw new ArticleImageReferenceError("Referenčna povezava vsebuje nedovoljen naslov.");
  }
  return url;
}

async function resolveVerifiedAddress(url: URL): Promise<string> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedIp(address))) {
    throw new ArticleImageReferenceError("Referenčna povezava kaže na nedovoljen ali notranji strežnik.");
  }
  return addresses[0]!.address;
}

function stripTrailingUrlPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "").replace(/[)\]}]+$/g, (suffix) => {
    const opening = { ")": "(", "]": "[", "}": "{" }[suffix[0]!];
    return opening && value.includes(opening) ? suffix : "";
  });
}

export function extractArticleImageReferenceUrls(description: string): string[] {
  const candidates = description.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const urls: string[] = [];
  for (const candidate of candidates) {
    const normalized = stripTrailingUrlPunctuation(candidate);
    if (!urls.includes(normalized)) urls.push(normalized);
  }
  if (urls.length > MAX_ARTICLE_REFERENCE_URLS) {
    throw new ArticleImageReferenceError(`V opisu so lahko največ ${MAX_ARTICLE_REFERENCE_URLS} referenčne povezave.`);
  }
  return urls;
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2F;|&#47;/gi, "/");
}

export function extractArticleImageUrlsFromHtml(html: string, pageUrl: string): string[] {
  const candidates: string[] = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const property = (htmlAttribute(tag, "property") ?? htmlAttribute(tag, "name"))?.toLowerCase();
    if (property === "og:image" || property === "twitter:image" || property === "twitter:image:src") {
      const content = htmlAttribute(tag, "content");
      if (content) candidates.push(content);
    }
  }
  for (const match of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = match[0];
    const src = htmlAttribute(tag, "src") ?? htmlAttribute(tag, "data-src");
    if (src) candidates.push(src);
    const srcset = htmlAttribute(tag, "srcset");
    if (srcset) candidates.push(srcset.split(",")[0]!.trim().split(/\s+/)[0]!);
  }

  const absoluteUrls: string[] = [];
  for (const candidate of candidates) {
    try {
      const url = new URL(decodeHtmlEntities(candidate), pageUrl);
      if ((url.protocol === "https:" || url.protocol === "http:") && !absoluteUrls.includes(url.toString())) {
        absoluteUrls.push(url.toString());
      }
    } catch {
      // Ignore malformed image attributes and try the next candidate.
    }
    if (absoluteUrls.length >= MAX_IMAGE_CANDIDATES) break;
  }
  return absoluteUrls;
}

function responseHeader(response: IncomingMessage, name: string): string {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function readResponseBytes(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(responseHeader(response, "content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    response.destroy();
    throw new ArticleImageReferenceError("Referenčna slika je prevelika.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const value of response) {
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy();
        throw new ArticleImageReferenceError("Referenčna slika ali spletna stran je prevelika.");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ArticleImageReferenceError) throw error;
    throw new ArticleImageReferenceError("Referenčne slike ni bilo mogoče pravočasno prebrati.");
  }
  return Buffer.concat(chunks);
}

function openPinnedHttpsRequest(url: URL, address: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let response: IncomingMessage | undefined;
    let resolved = false;
    let deadline: NodeJS.Timeout | undefined;
    const clearDeadline = () => {
      if (deadline) clearTimeout(deadline);
    };
    const request = httpsRequest({
      protocol: "https:",
      hostname: address,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // Povezava gre na preverjen IP, TLS certifikat in Host pa ostaneta vezana
      // na prvotno domeno. Tako DNS po preverjanju ne more zamenjati cilja.
      servername: url.hostname.replace(/^\[|\]$/g, ""),
      headers: {
        Host: url.host,
        Accept: "text/html,image/jpeg,image/png,image/webp",
      },
    }, (incomingResponse) => {
      response = incomingResponse;
      resolved = true;
      incomingResponse.once("end", clearDeadline);
      incomingResponse.once("close", clearDeadline);
      incomingResponse.once("error", clearDeadline);
      resolve(incomingResponse);
    });
    // Socket timeout only detects inactivity. This absolute deadline also
    // stops a remote server that continuously drips a never-ending body.
    deadline = setTimeout(() => {
      const timeoutError = new Error("Reference request timed out");
      response?.destroy(timeoutError);
      request.destroy(timeoutError);
    }, REFERENCE_TIMEOUT_MS);
    request.on("error", (error) => {
      clearDeadline();
      if (!resolved) reject(error);
    });
    request.end();
  });
}

async function fetchReferenceResponse(url: URL, redirects = 0): Promise<{ url: URL; response: IncomingMessage }> {
  let address: string;
  try {
    address = await resolveVerifiedAddress(url);
  } catch (error) {
    if (error instanceof ArticleImageReferenceError) throw error;
    throw new ArticleImageReferenceError("Naslova referenčne povezave ni bilo mogoče varno preveriti.");
  }
  let response: IncomingMessage;
  try {
    response = await openPinnedHttpsRequest(url, address);
  } catch {
    throw new ArticleImageReferenceError("Referenčne povezave ni bilo mogoče odpreti.");
  }
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    if (redirects >= MAX_REDIRECTS) {
      response.destroy();
      throw new ArticleImageReferenceError("Referenčna povezava ima preveč preusmeritev.");
    }
    const location = responseHeader(response, "location");
    if (!location) {
      response.destroy();
      throw new ArticleImageReferenceError("Referenčna povezava ima neveljavno preusmeritev.");
    }
    response.destroy();
    const redirectedUrl = validateReferenceUrl(new URL(location, url).toString());
    return fetchReferenceResponse(redirectedUrl, redirects + 1);
  }
  return { url, response };
}

async function fetchReferenceImage(rawUrl: string, allowHtml = true): Promise<ArticleImageReference> {
  const requestedUrl = validateReferenceUrl(rawUrl);
  const { url, response } = await fetchReferenceResponse(requestedUrl);
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    response.destroy();
    throw new ArticleImageReferenceError(`Referenčne strani ni mogoče prebrati (HTTP ${status}).`);
  }
  const contentType = responseHeader(response, "content-type").split(";", 1)[0]!.toLowerCase();
  if (REFERENCE_IMAGE_MIME_TYPES.has(contentType)) {
    const bytes = await readResponseBytes(response, MAX_ARTICLE_REFERENCE_IMAGE_BYTES);
    if (!bytes.length) throw new ArticleImageReferenceError("Referenčna slika je prazna.");
    if (!hasExpectedImageSignature(bytes, contentType)) {
      throw new ArticleImageReferenceError("Referenčna slika nima veljavne podprte slikovne vsebine.");
    }
    return { sourceUrl: url.toString(), mimeType: contentType, b64Json: bytes.toString("base64") };
  }
  if (!allowHtml || (contentType !== "text/html" && contentType !== "application/xhtml+xml")) {
    response.destroy();
    throw new ArticleImageReferenceError("Referenčna povezava ne vsebuje spletne strani ali podprte slike.");
  }

  const html = (await readResponseBytes(response, MAX_HTML_BYTES)).toString("utf8");
  const imageUrls = extractArticleImageUrlsFromHtml(html, url.toString());
  if (!imageUrls.length) {
    throw new ArticleImageReferenceError("Na referenčni strani ni bilo mogoče najti slike.");
  }
  for (const imageUrl of imageUrls) {
    try {
      return await fetchReferenceImage(imageUrl, false);
    } catch (error) {
      if (error instanceof ArticleImageReferenceError) continue;
    }
  }
  throw new ArticleImageReferenceError("Nobene slike z referenčne strani ni bilo mogoče varno pridobiti.");
}

function hasExpectedImageSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

export async function loadArticleImageReferences(urls: string[]): Promise<ArticleImageReference[]> {
  const references: ArticleImageReference[] = [];
  let totalBytes = 0;
  for (const url of urls) {
    const reference = await fetchReferenceImage(url);
    const byteLength = Buffer.byteLength(reference.b64Json, "base64");
    totalBytes += byteLength;
    if (totalBytes > MAX_ARTICLE_REFERENCE_TOTAL_BYTES) {
      throw new ArticleImageReferenceError("Skupna velikost referenčnih slik je prevelika.");
    }
    references.push(reference);
  }
  return references;
}