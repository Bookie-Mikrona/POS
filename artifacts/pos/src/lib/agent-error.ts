export function resolveAgentErrorMessage(
  status: number,
  payload?: { napaka?: string; error?: string } | null,
): string {
  if (status === 401) {
    return "AI pomočnik potrebuje aktivnega natakarja. Kliknite »Zakleni POS« in ga nato odklenite s svojim ID-jem natakarja in PIN-om.";
  }
  return payload?.napaka || payload?.error || `Strežnik je vrnil napako: ${status}`;
}