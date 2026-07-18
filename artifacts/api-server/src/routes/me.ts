import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import type { EmailAddress } from "@clerk/express";

const router = Router();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as Request & { userId: string }).userId = userId;
  next();
};

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const user = await clerkClient.users.getUser(userId);

    const primaryEmail = user.emailAddresses.find(
      (e: EmailAddress) => e.id === user.primaryEmailAddressId,
    );

    res.json({
      id: user.id,
      email: primaryEmail?.emailAddress ?? "",
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      imageUrl: user.imageUrl ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch user");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
