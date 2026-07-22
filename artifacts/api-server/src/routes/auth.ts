/**
 * Auth pomožne poti — /api/auth/*
 * Ni potrebna super admin vloga, zadostuje veljavna seja.
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { clerkClient } from "@clerk/express";

const router = Router();

/**
 * POST /api/auth/end-session
 * Kliče ga brskalnik ob zapiranju zavihka/brskalnika (beforeunload + keepalive fetch).
 * Razveljavi trenutno Clerk sejo, tako da je uporabnik takoj odjavljen.
 */
router.post("/auth/end-session", async (req: Request, res: Response): Promise<void> => {
  const auth = getAuth(req);
  const sessionId = auth?.sessionId;

  if (!sessionId) {
    // Seja ni bila prepoznana (npr. že poteče ali ni žetona) — ni napake
    res.status(204).send();
    return;
  }

  try {
    await clerkClient.sessions.revokeSession(sessionId);
  } catch {
    // Seja morda že ni veljavna — ni kritično
  }

  res.status(204).send();
});

export default router;
