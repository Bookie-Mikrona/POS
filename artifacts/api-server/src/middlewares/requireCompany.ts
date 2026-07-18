import { type Response, type NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db, accountingRolesTable, companiesTable } from "@workspace/db";
import { type AuthenticatedRequest } from "./requireAuth";

export interface CompanyRequest extends AuthenticatedRequest {
  companyId: string;
  companyRole: "owner" | "accountant" | "viewer";
}

/**
 * Middleware: razreši aktivno podjetje iz glave X-Company-Id.
 * Preveri, da ima prijavljeni uporabnik dostop do podjetja.
 * Nastavi req.companyId in req.companyRole ali vrne 401/403/404.
 *
 * Mora se uporabiti ZA requireAuth.
 */
export function requireCompany(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const companyId = req.headers["x-company-id"];
  if (!companyId || typeof companyId !== "string") {
    res.status(400).json({ error: "Manjka glava X-Company-Id" });
    return;
  }

  // Async check — Express 5 propagates thrown errors automatically
  resolveCompany(req, res, next, companyId).catch(next);
}

async function resolveCompany(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  companyId: string,
): Promise<void> {
  const [row] = await db
    .select({
      companyId: accountingRolesTable.companyId,
      role: accountingRolesTable.role,
    })
    .from(accountingRolesTable)
    .innerJoin(
      companiesTable,
      eq(companiesTable.id, accountingRolesTable.companyId),
    )
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, req.clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
    return;
  }

  (req as unknown as CompanyRequest).companyId = row.companyId;
  (req as unknown as CompanyRequest).companyRole = row.role;
  next();
}

/**
 * Pomožni middleware: zahteva vlogo owner ali accountant (ne viewer).
 * Mora se uporabiti ZA requireCompany.
 */
export function requireAccountant(
  req: CompanyRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.companyRole === "viewer") {
    res
      .status(403)
      .json({ error: "Za to dejanje potrebujete vlogo računovodja ali lastnik" });
    return;
  }
  next();
}

/**
 * Pomožni middleware: zahteva vlogo owner.
 * Mora se uporabiti ZA requireCompany.
 */
export function requireOwner(
  req: CompanyRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.companyRole !== "owner") {
    res
      .status(403)
      .json({ error: "Za to dejanje potrebujete vlogo lastnik" });
    return;
  }
  next();
}
