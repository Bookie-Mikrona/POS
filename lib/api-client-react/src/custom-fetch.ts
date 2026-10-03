export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto" | "stream";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = (options?: { skipCache?: boolean }) => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _napravaIdGetter: (() => string | null) | null = null;
let _enotaIdGetter: (() => string | null) | null = null;
let _posActorSessionGetter: (() => string | null) | null = null;
/** Callback, ki se pokliče, ko klic vrne 401 in ga refresh žetona ne reši. */
let _on401Handler: (() => void) | null = null;

/**
 * Polira za veljaven žeton do maxWaitMs (privzeto 2500ms), vsakih ~150ms.
 * Vrne žeton takoj ko postane na voljo, ali null po preteku časa.
 * Namen: Clerk po sveži prijavi potrebuje kratek čas da JWT pripravi; brez tega
 * bi klic šel ven brez Authorization → 401, čeprav seja obstaja.
 */
async function awaitToken(maxWaitMs = 2500): Promise<string | null> {
  const pollMs = 150;
  const maxAttempts = Math.ceil(maxWaitMs / pollMs);
  for (let i = 0; i < maxAttempts; i++) {
    if (_authTokenGetter) {
       const t = await _authTokenGetter();
      if (t) return t;
    }
    if (i < maxAttempts - 1) {
      await new Promise<void>(r => setTimeout(r, pollMs));
    }
  }
  return null;
}

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

export function setNapravaIdGetter(getter: (() => string | null) | null): void {
  _napravaIdGetter = getter;
}

/**
 * Register a getter that supplies the active POS enota (business unit) ID.
 * Before every fetch the getter is invoked; when it returns a non-null string,
 * an `X-Enota-Id` header is attached to the request.
 */
export function setEnotaIdGetter(getter: (() => string | null) | null): void {
  _enotaIdGetter = getter;
}
/** Supplies the short-lived, server-signed POS actor selection. */
export function setPosActorSessionGetter(getter: (() => string | null) | null): void {
  _posActorSessionGetter = getter;
}

/**
 * Registriraj callback, ki se sproži, ko klic vrne 401 in ga token-refresh retry
 * ne reši (potekla seja). Uporabi za preusmeritev na /sign-in.
 * Pass `null` to clear.
 */
export function setOn401Handler(handler: (() => void) | null): void {
  _on401Handler = handler;
}

/** Returns the current auth bearer token (or null). Useful for direct fetch() calls outside the generated client. */
export async function getAuthToken(options?: { skipCache?: boolean }): Promise<string | null> {
  if (!_authTokenGetter) return null;
  return _authTokenGetter(options);
}

/** Returns the current enota ID string (or null). Useful for direct fetch() calls outside the generated client. */
export function getEnotaId(): string | null {
  if (!_enotaIdGetter) return null;
  return _enotaIdGetter();
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto" | "stream",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  // Streaming callers must consume the body themselves; retain the normal
  // authentication, tenant headers and expired-token retry in customFetch.
  if (responseType === "stream") return response;
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  // Če getToken() vrne null (Clerk JWT se še inicializira po sveži prijavi),
  // počakamo do ~2s — preprečimo, da zahtevek gre ven brez žetona.
  if (_authTokenGetter && !headers.has("authorization")) {
    let token = await _authTokenGetter();
    if (!token) token = await awaitToken(2000);
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
    // Še vedno null po 2s: pošlji brez Auth — server vrne 401 → retry spodaj bo počakal
  }
  if (_posActorSessionGetter && !headers.has("x-pos-actor-session")) {
    const actorSession = _posActorSessionGetter();
    if (actorSession) headers.set("x-pos-actor-session", actorSession);
  }

  const companyId = (() => {
    try {
      const stored = localStorage.getItem("erp_active_company");
      return stored ? JSON.parse(stored)?.id : null;
    } catch { return null; }
  })();

  if (companyId && !headers.has("x-company-id")) {
    headers.set("x-company-id", companyId);
  }

  if (_napravaIdGetter && !headers.has("x-naprava-id")) {
    const napravaId = _napravaIdGetter();
    if (napravaId) headers.set("x-naprava-id", napravaId);
  }

  if (_enotaIdGetter && !headers.has("x-enota-id")) {
    const enotaId = _enotaIdGetter();
    if (enotaId) headers.set("x-enota-id", enotaId);
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const response = await fetch(input, { ...init, method, headers });

  if (!response.ok) {
    // ── 401: enkratni token-refresh retry ────────────────────────────────────
    // Pokrije prehodni race (Clerk JWT se po sveži prijavi inicializira z zamudo).
    // 1. Pridobi svež žeton prek _authTokenGetter (ki zdaj kliče skipCache:true →
    //    aktiven Clerk refresh). Če vrne null, počakaj do ~2.5s (awaitToken).
    // 2. Retry SAMO enkrat z novim žetonom.
    // 3. Šele ko po čakanju žetona ni → seja dejansko mrtva → _on401Handler.
    if (response.status === 401 && _authTokenGetter) {
       let freshToken = await _authTokenGetter({ skipCache: true });
      if (!freshToken) freshToken = await awaitToken(2500);
      if (freshToken) {
        const retryHeaders = new Headers(headers);
        retryHeaders.set("authorization", `Bearer ${freshToken}`);
        // Actor selection and business unit can change while the first
        // request is in flight. Re-read only the headers managed by their
        // configured getters; leave caller and other managed headers intact.
        if (_posActorSessionGetter) {
          retryHeaders.delete("x-pos-actor-session");
          const actorSession = _posActorSessionGetter();
          if (actorSession) retryHeaders.set("x-pos-actor-session", actorSession);
        }
        if (_enotaIdGetter) {
          retryHeaders.delete("x-enota-id");
          const enotaId = _enotaIdGetter();
          if (enotaId) retryHeaders.set("x-enota-id", enotaId);
        }
        const retryResponse = await fetch(input, { ...init, method, headers: retryHeaders });
        if (retryResponse.ok) {
          return (await parseSuccessBody(retryResponse, responseType, requestInfo)) as T;
        }
        // Retry prav tako 401 → seja potekla; sproži handler in vrzi napako
        if (retryResponse.status === 401) _on401Handler?.();
        const retryError = await parseErrorBody(retryResponse, method);
        throw new ApiError(retryResponse, retryError, requestInfo);
      }
      // Po ~2.5s čakanja žetona še vedno ni → seja dejansko mrtva
      _on401Handler?.();
    }
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}
