import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/express";
import { describe, it } from "vitest";
import { requireDevelopmentClerkIntegration } from "./clerkIntegrationSafety";
import { resolveReportExporterNames } from "./reportExporterNames";

// No assertions may print actual values: IDs, names, emails and SDK errors are private.
class SafeContractError extends Error {}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SafeContractError(message);
}

describe.skipIf(process.env.RUN_CLERK_EXPORT_HISTORY_INTEGRATION !== "1")(
  "development Clerk report exporter contract (read-only)",
  () => {
    it("filters SDK pages, selects primary email and omits a missing user without losing an existing one", async () => {
      const secretKey = requireDevelopmentClerkIntegration(process.env);
      check(process.env.NODE_ENV === "test", "Use the Vitest test runtime for the guarded Clerk transport.");
      // Explicit endpoint/version prevent environment overrides from redirecting the test.
      const client = createClerkClient({
        secretKey,
        apiUrl: "https://api.clerk.com",
        apiVersion: "v1",
        telemetry: { disabled: true },
      });
      // This SDK fetches /users and /users/count for each paginated list.
      const nativeFetch = globalThis.fetch;
      let stage = "discover development fixture";
      let transportFailure = "";
      globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        check(url.origin === "https://api.clerk.com"
          && ["/v1/users", "/v1/users/count"].includes(url.pathname)
          && method === "GET", "Clerk integration blocked a non-read-only request.");
        try {
          const response = await nativeFetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
          transportFailure = response.ok ? "" : `HTTP ${response.status}`;
          return response;
        } catch {
          transportFailure = "network request failed";
          throw new SafeContractError("Clerk read-only network request failed.");
        }
      };
      try {
        // Discover one existing development account; no IDs or PII are written to disk.
        const sample = await client.users.getUserList({ limit: 1 });
        check(!Array.isArray(sample) && Array.isArray(sample.data)
          && Number.isInteger(sample.totalCount), "Clerk pagination envelope changed.");
        check(sample.data.length === 1, "Clerk development instance needs an existing account.");
        const existing = sample.data[0];
        check(typeof existing.id === "string" && Array.isArray(existing.emailAddresses),
          "Clerk user resource shape changed.");
        const primary = existing.emailAddresses.find((email) => email.id === existing.primaryEmailAddressId);
        check(Boolean(primary?.emailAddress), "Development fixture needs a primary email address.");

        // A missing, syntactically valid ID models an exporter whose account was deleted.
        // Never create/delete a Clerk user just to make a test fixture.
        const missingId = `user_${randomUUID().replaceAll("-", "")}`;
        stage = "mixed-ID filter";
        const filtered = await client.users.getUserList({
          userId: [existing.id, missingId], limit: 100,
        });
        check(!Array.isArray(filtered) && Array.isArray(filtered.data)
          && filtered.totalCount === 1 && filtered.data.length === 1,
        "Clerk mixed-ID filtering or pagination contract changed.");
        check(filtered.data[0].id === existing.id,
          "Clerk userId filtering lost the existing account or returned an unrelated account.");
        stage = "missing-only filter";
        const missing = await client.users.getUserList({ userId: [missingId], limit: 100 });
        check(missing.totalCount === 0 && missing.data.length === 0,
          "Clerk did not omit the nonexistent account.");

        stage = "shared history resolver";
        const names = await resolveReportExporterNames([existing.id, missingId, existing.id], client.users);
        const expectedName = [existing.firstName?.trim(), existing.lastName?.trim()].filter(Boolean).join(" ");
        check(names.size === 1 && !names.has(missingId)
          && names.get(existing.id) === (expectedName || primary!.emailAddress.trim()),
        "History exporter resolution did not preserve the existing identity.");

        // Exercise the email fallback with the real returned resource, without changing
        // Clerk. Place the actual primary last so array order cannot mask a regression.
        const sdkUser = filtered.data[0];
        const secondary: NonNullable<typeof primary> = Object.assign(Object.create(primary!), {
          id: "synthetic_secondary", emailAddress: "secondary@example.invalid",
        });
        const namelessUser: typeof sdkUser = Object.assign(Object.create(sdkUser), {
          firstName: null, lastName: null,
          emailAddresses: [
            secondary,
            ...sdkUser.emailAddresses.filter((email) => email.id !== sdkUser.primaryEmailAddressId),
            primary!,
          ],
        });
        const emailNames = await resolveReportExporterNames([existing.id], {
          getUserList: async () => ({
            ...filtered,
            data: [namelessUser],
          }),
        });
        check(emailNames.get(existing.id) === primary!.emailAddress.trim(),
          "History exporter resolution did not prefer the actual primary email.");
      } catch (error) {
        // SDK errors may contain request IDs, payloads or credentials; never rethrow them.
        if (error instanceof SafeContractError) throw error;
        throw new Error(`Development Clerk exporter contract failed at ${stage} (${transportFailure || "SDK response"}); private response data redacted.`);
      } finally {
        globalThis.fetch = nativeFetch;
      }
    }, 90_000);
  },
);
