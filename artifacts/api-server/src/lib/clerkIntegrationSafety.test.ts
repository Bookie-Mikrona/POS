import { describe, expect, it } from "vitest";
import { requireDevelopmentClerkIntegration } from "./clerkIntegrationSafety";

const development = {
  RUN_CLERK_EXPORT_HISTORY_INTEGRATION: "1",
  NODE_ENV: "test",
  CLERK_SECRET_KEY: "sk_test_fake",
  CLERK_PUBLISHABLE_KEY: "pk_test_fake",
};

describe("live Clerk integration safety", () => {
  it("accepts only an explicitly enabled development client", () => {
    expect(requireDevelopmentClerkIntegration(development)).toBe("sk_test_fake");
  });

  it.each([
    { RUN_CLERK_EXPORT_HISTORY_INTEGRATION: undefined },
    { RUN_CLERK_EXPORT_HISTORY_INTEGRATION: "true" },
    { NODE_ENV: "production" },
    { REPLIT_DEPLOYMENT: "1" },
    { CLERK_SECRET_KEY: undefined },
    { CLERK_SECRET_KEY: "sk_live_fake" },
    { CLERK_PUBLISHABLE_KEY: "pk_live_fake" },
  ])("refuses unsafe configuration without disclosing values %#", (override) => {
    let message = "";
    try {
      requireDevelopmentClerkIntegration({ ...development, ...override });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(Boolean(message)).toBe(true);
    expect(message.includes("fake")).toBe(false);
  });
});
