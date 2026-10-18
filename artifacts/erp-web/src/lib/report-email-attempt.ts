/** A retry keeps its key, while an explicit new export or changed input gets a new one. */
export function createReportEmailAttempt() {
  let attempt: { signature: string; key: string } | undefined;
  return {
    keyFor(payload: Record<string, unknown>): string {
      const signature = JSON.stringify(Object.keys(payload).sort()
        .filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
      if (!attempt || attempt.signature !== signature) {
        attempt = { signature, key: crypto.randomUUID() };
      }
      return attempt.key;
    },
    reset() { attempt = undefined; },
  };
}
