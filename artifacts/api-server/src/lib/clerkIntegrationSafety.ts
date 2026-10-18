/** Call before constructing any live SDK client. Never include env values in errors. */
export function requireDevelopmentClerkIntegration(env: NodeJS.ProcessEnv): string {
  if (env.RUN_CLERK_EXPORT_HISTORY_INTEGRATION !== "1") {
    throw new Error("Live Clerk integration requires explicit opt-in.");
  }
  if (env.NODE_ENV === "production" || env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Live Clerk integration is forbidden in production.");
  }
  if (!env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Live Clerk integration requires a development secret key.");
  }
  if (env.CLERK_PUBLISHABLE_KEY && !env.CLERK_PUBLISHABLE_KEY.startsWith("pk_test_")) {
    throw new Error("Live Clerk integration refuses a non-development publishable key.");
  }
  return env.CLERK_SECRET_KEY;
}
