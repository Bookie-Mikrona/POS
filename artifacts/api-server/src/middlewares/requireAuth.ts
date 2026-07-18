import { type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";

export interface AuthenticatedRequest extends Request {
  clerkUserId: string;
}

/**
 * Middleware: zahteva veljavno Clerk sejo.
 * Nastavi req.clerkUserId ali vrne 401.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Neprijavljeni dostop ni dovoljen" });
    return;
  }
  (req as AuthenticatedRequest).clerkUserId = auth.userId;
  next();
}
