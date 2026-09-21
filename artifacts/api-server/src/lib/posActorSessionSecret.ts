export function getPosActorSessionSecret(
  env: Partial<Record<"POS_ACTOR_SESSION_SECRET" | "SESSION_SECRET", string>> = process.env,
): string | null {
  return env.POS_ACTOR_SESSION_SECRET || env.SESSION_SECRET || null;
}