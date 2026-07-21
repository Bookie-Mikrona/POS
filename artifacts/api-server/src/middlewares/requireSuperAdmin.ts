import { type Request, type Response, type NextFunction } from "express";
import { type AuthenticatedRequest } from "./requireAuth";

/**
 * Middleware: dostop samo za super adminov.
 * Super admini so definirani v env var SUPER_ADMIN_IDS (vejičnik-ločen seznam Clerk user ID-jev).
 * Zahteva, da je requireAuth že bil zagnan (nastavi req.clerkUserId).
 */
export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.clerkUserId) {
    res.status(401).json({ error: "Neprijavljeni dostop ni dovoljen" });
    return;
  }

  const superAdminIds = (process.env.SUPER_ADMIN_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!superAdminIds.includes(authReq.clerkUserId)) {
    req.log?.warn({ clerkUserId: authReq.clerkUserId, superAdminIds }, "requireSuperAdmin: 403 forbidden");
    res.status(403).json({ error: "Dostop samo za administratorje sistema" });
    return;
  }

  next();
}

/** Preveri, ali je dani Clerk user ID super admin. */
export function isSuperAdmin(clerkUserId: string): boolean {
  const superAdminIds = (process.env.SUPER_ADMIN_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return superAdminIds.includes(clerkUserId);
}
