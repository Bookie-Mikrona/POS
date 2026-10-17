import { afterAll, describe, expect, it, vi } from "vitest";

const isolation = vi.hoisted(() => ({ tx: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, key) {
        const executor = isolation.tx ?? target;
        const value = executor[key];
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "TEST-active-account-templates";
    next();
  },
}));
vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } } }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile() {
      return { download: async () => [Buffer.from("fixture PDF")] };
    }
  },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountsTable,
  counterpartiesTable, counterpartyAccountTemplatesTable,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import counterpartiesRouter from "./counterparties";
import { runOcrWithClaude } from "./documents";

const app = express();
app.use(counterpartiesRouter);
afterAll(() => pool.end());

async function withTemplates(
  check: (fixture: {
    companyId: string;
    counterpartyId: string;
    activeAccountId: string;
    inactiveAccountId: string;
    activeTemplateId: string;
  }) => Promise<void>,
) {
  const rollback = new Error("rollback active-account template fixtures");
  let companyId: string | undefined;
  try {
    await db.transaction(async tx => {
      isolation.tx = tx;
      const [company] = await db.insert(companiesTable).values({
        naziv: "TEST template owner",
        podjetjeDavcna: `TEST-TEMPLATES-${crypto.randomUUID()}`,
      }).returning();
      companyId = company.id;
      await db.insert(accountingRolesTable).values({
        companyId,
        clerkUserId: "TEST-active-account-templates",
        role: "owner",
      });
      const [counterparty] = await db.insert(counterpartiesTable).values({
        companyId, name: "TEST template supplier", taxId: "99887766", type: "supplier",
      }).returning();
      const [active, inactive] = await db.insert(accountsTable).values([
        { companyId, code: "4198761", name: "Active template expense", type: "expense", isActive: true, allowsPosting: true },
        { companyId, code: "4198762", name: "Inactive template expense", type: "expense", isActive: true, allowsPosting: true },
      ]).returning();
      // Same partner, document direction and description; only the account differs.
      const [activeTemplate] = await db.insert(counterpartyAccountTemplatesTable).values(
        [active, inactive].map(account => ({
          companyId: company.id,
          counterpartyId: counterparty.id,
          accountId: account.id,
          documentType: "invoice_received",
          lastLineDescription: "Template regression service",
          usageCount: account.id === active.id ? 2 : 99,
        })),
      ).returning();
      // Model the real regression: an account is deactivated after its template was saved.
      await db.update(accountsTable).set({ isActive: false }).where(eq(accountsTable.id, inactive.id));
      expect(await db.select().from(counterpartyAccountTemplatesTable)
        .where(eq(counterpartyAccountTemplatesTable.companyId, company.id))).toHaveLength(2);

      await check({
        companyId: company.id,
        counterpartyId: counterparty.id,
        activeAccountId: active.id,
        inactiveAccountId: inactive.id,
        activeTemplateId: activeTemplate.id,
      });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    isolation.tx = null;
  }
  if (companyId) {
    expect(await db.select({ id: companiesTable.id }).from(companiesTable)
      .where(eq(companiesTable.id, companyId))).toEqual([]);
  }
}

describe("saved account templates exclude deactivated accounts", () => {
  it("passes only the active saved template to the OCR model", async () => {
    await withTemplates(async ({ companyId }) => {
      vi.mocked(anthropic.messages.create).mockReset();
      vi.mocked(anthropic.messages.create).mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ rawText: "", confidence: 1, lines: [] }) }],
      } as any);

      await runOcrWithClaude("/objects/test.pdf", "application/pdf", companyId);

      expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
      const args = vi.mocked(anthropic.messages.create).mock.calls[0][0];
      const content = args.messages[0].content;
      if (typeof content === "string") throw new Error("Expected OCR file and prompt blocks");
      const promptBlock = content.find(block => block.type === "text");
      if (!promptBlock || promptBlock.type !== "text") throw new Error("Missing OCR prompt");
      const prompt = promptBlock.text;
      const templates = prompt.split("SHRANJENE PREDLOGE KONTIRANJA PO PARTNERJIH")[1]
        .split("PRETEKLE POTRJENE KNJIŽBE PO PARTNERJIH")[0];
      expect(templates).toContain("TEST template supplier");
      expect(templates).toContain("[2× potrjeno]");
      expect(templates).toContain("konto 4198761 (Active template expense)");
      expect(templates).not.toContain("4198762");
      expect(templates).not.toContain("Inactive template expense");
      expect(prompt).not.toContain("4198762");
    });
  });

  it("GET account-templates returns only the active account and exposes accountIsActive", async () => {
    await withTemplates(async fixture => {
      const response = await request(app)
        .get(`/companies/${fixture.companyId}/counterparties/${fixture.counterpartyId}/account-templates`);

      expect(response.status).toBe(200);
      expect(response.body.templates).toHaveLength(1);
      expect(response.body.templates[0]).toMatchObject({
        id: fixture.activeTemplateId,
        accountId: fixture.activeAccountId,
        accountCode: "4198761",
        accountName: "Active template expense",
        accountIsActive: true,
        documentType: "invoice_received",
        lastLineDescription: "Template regression service",
        usageCount: 2,
      });
      expect(response.body.templates.map((row: { accountId: string }) => row.accountId))
        .not.toContain(fixture.inactiveAccountId);
    });
  });
});
