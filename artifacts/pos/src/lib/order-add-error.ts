/** Show actionable API validation errors, but keep transport/server failures generic. */
export function orderAddErrorMessage(error: unknown, fallback = "Ni bilo mogoče dodati artikla"): string {
  if (!error || typeof error !== "object") return fallback;
  const err = error as { status?: unknown; data?: unknown; response?: { data?: unknown } };
  if (typeof err.status === "number" && err.status >= 500) return fallback;
  const data = err.data ?? err.response?.data;
  if (!data || typeof data !== "object") return fallback;
  const body = data as { error?: unknown; napaka?: unknown; message?: unknown };
  const reason = body.error ?? body.napaka ?? body.message;
  return typeof reason === "string" && reason.trim() ? reason : fallback;
}