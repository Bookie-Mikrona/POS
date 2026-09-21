/**
 * fursVatCodes.ts — GET seznam FURS globalnih DDV kod
 *
 * Endpoint: GET /companies/:companyId/furs-vat-codes
 *
 * Vrne globalne FURS kode iz vat_code tabele (ne company-specifičnih vatCodesTable).
 * Potrebno za UI v temeljnicah: računovodja izbere kodo (P22, PN22, EUB22, …),
 * sistem pa na podlagi kprVatField zazna neodbitne kode.
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc } from "drizzle-orm";
import { db, vatCodeTable, accountingRolesTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * GET /companies/:companyId/furs-vat-codes
 *
 * Vrne vse aktivne FURS kode. Dostop zahteva membership v podjetju.
 * Query params:
 *   direction=IN|OUT — filtriraj samo vstopne ali izstopne kode
 */
router.get(
  "/companies/:companyId/furs-vat-codes",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    // Preveri dostop do podjetja
    const [role] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(
        and(
          eq(accountingRolesTable.clerkUserId, authReq.clerkUserId),
          eq(accountingRolesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!role) {
      res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
      return;
    }

    const dirFilter = req.query.direction as string | undefined;

    // Vse vat_code vrstice (globalna tabela, ni vezana na company)
    const rows = await db
      .select({
        id: vatCodeTable.id,
        code: vatCodeTable.code,
        description: vatCodeTable.description,
        direction: vatCodeTable.direction,
        rate: vatCodeTable.rate,
        kprBaseField: vatCodeTable.kprBaseField,
        kprVatField: vatCodeTable.kprVatField,
        kirBaseField: vatCodeTable.kirBaseField,
        kirVatField: vatCodeTable.kirVatField,
        isReverseCharge: vatCodeTable.isReverseCharge,
        isImport: vatCodeTable.isImport,
        validFrom: vatCodeTable.validFrom,
        validTo: vatCodeTable.validTo,
      })
      .from(vatCodeTable)
      .orderBy(asc(vatCodeTable.direction), asc(vatCodeTable.code));

    // Filtriraj po direction, če podan
    const codes = rows.filter((r) => {
      if (dirFilter && r.direction !== dirFilter) return false;
      return true;
    });

    // isNonDeductible: direction=IN, rate>0, kprVatField=NULL → DDV brez odbitka
    const result = codes.map((r) => ({
      ...r,
      rate: String(r.rate),
      isNonDeductible:
        r.direction === "IN" &&
        Number(r.rate) > 0 &&
        (r.kprVatField === null || r.kprVatField === undefined),
    }));

    res.json({ codes: result });
  },
);

export { router as fursVatCodesRouter };
