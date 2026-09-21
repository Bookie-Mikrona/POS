import {
  getAuthToken as getApiAuthToken,
  getEnotaId as getApiEnotaId,
} from "@workspace/api-client-react";

type PosAuthHeaderInput = {
  token: string | null;
  enotaId: string | null;
  actorSession: string | null;
  contentType?: string;
};

export function buildPosAuthHeaders({
  token,
  enotaId,
  actorSession,
  contentType,
}: PosAuthHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (enotaId) headers["X-Enota-Id"] = enotaId;
  if (actorSession) headers["X-Pos-Actor-Session"] = actorSession;
  return headers;
}

type PosFetchDependencies = {
  getAuthToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
  getEnotaId: () => string | null;
  getActorSession: () => string | null;
  fetch: typeof fetch;
};

const defaultDependencies: PosFetchDependencies = {
  getAuthToken: getApiAuthToken,
  getEnotaId: getApiEnotaId,
  getActorSession: () => (
    typeof sessionStorage === "undefined"
      ? null
      : sessionStorage.getItem("pos_actor_session")
  ),
  fetch: (...args) => fetch(...args),
};

function buildRequestHeaders(
  additionalHeaders: HeadersInit | undefined,
  token: string | null,
  dependencies: PosFetchDependencies,
): Headers {
  const headers = new Headers(additionalHeaders);
  headers.delete("Authorization");
  headers.delete("X-Enota-Id");
  headers.delete("X-Pos-Actor-Session");
  const authHeaders = buildPosAuthHeaders({
    token,
    enotaId: dependencies.getEnotaId(),
    actorSession: dependencies.getActorSession(),
  });
  for (const [name, value] of Object.entries(authHeaders)) {
    headers.set(name, value);
  }
  return headers;
}

export async function getPosAuthHeaders(
  additionalHeaders?: HeadersInit,
  dependencies: PosFetchDependencies = defaultDependencies,
): Promise<Headers> {
  return buildRequestHeaders(
    additionalHeaders,
    await dependencies.getAuthToken(),
    dependencies,
  );
}

export async function posFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  dependencies: PosFetchDependencies = defaultDependencies,
): Promise<Response> {
  const headers = await getPosAuthHeaders(init.headers, dependencies);
  const requestInit = {
    ...init,
    credentials: "include",
    headers,
  } satisfies RequestInit;
  const response = await dependencies.fetch(input, requestInit);
  if (response.status !== 401) return response;

  const refreshedToken = await dependencies.getAuthToken({ skipCache: true });
  if (!refreshedToken) return response;
  const retryHeaders = buildRequestHeaders(init.headers, refreshedToken, dependencies);
  return dependencies.fetch(input, {
    ...requestInit,
    headers: retryHeaders,
  });
}