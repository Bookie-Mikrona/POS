import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, eq, sql } from "drizzle-orm";
import { db, glasovniSinonimiTable } from "@workspace/db";

const router: IRouter = Router();

const PRIVZETI_SINONIMI: { beseda: string; alias: string }[] = [
  // Slo ↔ tuje ime
  { beseda: "pica",     alias: "pizza"     },
  { beseda: "kafa",     alias: "coffee"    },
  { beseda: "pivo",     alias: "beer"      },
  { beseda: "sok",      alias: "juice"     },
  { beseda: "čaj",      alias: "tea"       },
  { beseda: "špageti",  alias: "spaghetti" },
  { beseda: "rižota",   alias: "risotto"   },
  { beseda: "solata",   alias: "salad"     },
  { beseda: "juha",     alias: "soup"      },
  { beseda: "tortica",  alias: "cake"      },
  { beseda: "sladoled", alias: "gelato"    },
  { beseda: "beli",     alias: "beu"       },
  // Velikost pijač — veliko = 0,5 l / 5 dl
  { beseda: "veliko",   alias: "0,5"            },
  { beseda: "veliko",   alias: "0.5"            },
  { beseda: "veliko",   alias: "5 dl"           },
  { beseda: "veliko",   alias: "5dl"            },
  { beseda: "veliko",   alias: "pet decilitrov" },
  { beseda: "veliko",   alias: "pol litra"      },
  { beseda: "veliko",   alias: "pol litre"      },
  // Velikost pijač — malo/majhno = 0,3–0,33 l / 3 dl
  { beseda: "malo",     alias: "0,3"           },
  { beseda: "malo",     alias: "0.3"           },
  { beseda: "malo",     alias: "0,33"          },
  { beseda: "malo",     alias: "0.33"          },
  { beseda: "malo",     alias: "3 dl"          },
  { beseda: "malo",     alias: "3dl"           },
  { beseda: "malo",     alias: "tri decilitre" },
  { beseda: "malo",     alias: "tri decilitri" },
  { beseda: "majhno",   alias: "0,3"           },
  { beseda: "majhno",   alias: "0.3"           },
  { beseda: "majhno",   alias: "0,33"          },
  { beseda: "majhno",   alias: "0.33"          },
  { beseda: "majhno",   alias: "3 dl"          },
  { beseda: "majhno",   alias: "3dl"           },
  { beseda: "majhno",   alias: "tri decilitre" },
  { beseda: "majhno",   alias: "tri decilitri" },
];

router.get("/glasovni-sinonimi", async (req, res) => {
  const tenotaId = (req as any).enotaId ?? 1;
  let rows = await db
    .select()
    .from(glasovniSinonimiTable)
    .where(sql`true`)
    .orderBy(glasovniSinonimiTable.ustvarjeno);

  if (rows.length === 0 && "") {
    const inserted = await db
      .insert(glasovniSinonimiTable)
      .values(PRIVZETI_SINONIMI.map(s => ({ enotaId: tenotaId,
 beseda: s.beseda, alias: s.alias })))
      .returning();
    rows = inserted;
    req.log.info({ count: inserted.length }, "glasovni-sinonimi: posejani privzeti sinonimi");
  }

  res.json(rows.map(r => ({ id: r.id, beseda: r.beseda, alias: r.alias })));
});

router.post("/glasovni-sinonimi", async (req, res) => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) {
    res.status(400).json({ napaka: "Napačen vnos" });
    return;
  }
  const [row] = await db
    .insert(glasovniSinonimiTable)
    .values({
      enotaId: tenotaId,
      beseda: parsed.data.beseda.trim(),
      alias: parsed.data.alias?.trim() ?? ""})
    .returning();
  res.status(201).json({ id: row.id, beseda: row.beseda, alias: row.alias });
});

router.delete("/glasovni-sinonimi/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ napaka: "Napačen ID" });
    return;
  }
  await db
    .delete(glasovniSinonimiTable)
    .where(and(eq(glasovniSinonimiTable.id, id)));
  res.status(204).send();
});

export default router;
