#!/usr/bin/env node
/**
 * Doda pravilne importe vsem POS route datotekam.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const POS_DIR = "artifacts/api-server/src/routes/pos";

const ALL_TABLES = [
  "enoteTable","kategorijeTable","artikliTable","modSkupineTable","modifikatorjiTable",
  "modNormativiTable","artModSkupineTable","normativiTable","prostoriTable","mizeTable",
  "natakariTable","izmeneTable","narocilaTable","postavkeTable","prenosiNarocilTable",
  "racuniTable","blagajneTable","poslovniProstoriTable","nastavitveTable","napraveTable",
  "zalogeTable","zalogaGibiTable","prejemniceTable","prejemnicePostavkeTable",
  "inventureTable","inventurePostavkeTable","zacetneZalogeTable","zacetneZalogePostavkeTable",
  "shranjeniKupciTable","vivaVracilaTable","tiskalneNalogeTable","glasovniSinonimiTable",
  "dnevniMeniTable","partnerCenikiTable",
];

const DRIZZLE_FUNCS = [
  "eq","ne","and","or","lt","gt","lte","gte","like","ilike",
  "inArray","notInArray","isNull","isNotNull","between","notLike","sql","count",
  "sum","avg","asc","desc","alias",
];

const FURS_FN_LIST = [
  "posljiNaFURS","izracunajDDVZaokrozen","round2","preveriSkupajKonsistentnost",
  "izracunajZOILokalno","fursSOAPEcho","fursEchoDiagnostika",
];

const files = (await readdir(POS_DIR))
  .filter(f => f.endsWith(".ts") && f !== "index.ts" && f !== "enote.ts");

for (const file of files) {
  const filePath = join(POS_DIR, file);
  let content = await readFile(filePath, "utf-8");

  const usedTables = ALL_TABLES.filter(t => new RegExp(`\\b${t}\\b`).test(content));
  const usedDrizzle = DRIZZLE_FUNCS.filter(fn => new RegExp(`\\b${fn}\\b`).test(content));
  const fursFns = FURS_FN_LIST.filter(fn => new RegExp(`\\b${fn}\\b`).test(content));

  const usesRequireEnota   = /\brequireEnota\b/.test(content);
  const usesBroadcast      = /\bbroadcast\b/.test(content);
  const usesRecompute      = /\brecomputeZaloge\b/.test(content);
  const usesLogger         = /\blogger\b/.test(content);
  const usesNextFunction   = /\bNextFunction\b/.test(content);
  const usesUpsertKupec    = /\bupsertPogostKupec\b/.test(content) && file !== "kupec.ts";

  // --- Fix bad import lines before stripping ---
  content = content.replace(
    /import \{ posljiTestnoEmail \} from "\.\.\/lib\/email\.js";/g,
    'import { posljiTestnoEmail } from "../lib/pos-email";'
  );
  content = content.replace(
    /import \{ posljiEmailRacun \} from "\.\.\/lib\/email\.js";/g,
    'import { posljiEmailRacun } from "../lib/pos-email";'
  );

  // --- Strip lines now covered by the generated block ---
  const toStrip = [
    /^import \{ furs[^}]*\} from "\.\.\/lib\/pos-furs";[ \t]*\n?/gm,
    /^import bcrypt from "bcryptjs";[ \t]*\n?/gm,
    /^import \{ broadcast[^}]*\} from "\.\.\/lib\/pos-sse";[ \t]*\n?/gm,
    /^import \{ recomputeZaloge[^}]*\} from "\.\.\/lib\/pos-zaloge-utils";[ \t]*\n?/gm,
    /^import \{ logger[^}]*\} from "\.\.\/lib\/logger";[ \t]*\n?/gm,
    /^import \{ upsertPogostKupec[^}]*\} from "\.\/kupec";[ \t]*\n?/gm,
    /^import \{ requireEnota[^}]*\} from "\.\.\/\.\.\/middlewares\/pos";[ \t]*\n?/gm,
  ];
  for (const re of toStrip) content = content.replace(re, "");
  content = content.replace(/\n{3,}/g, "\n\n").trimStart();

  // --- Build new import block ---
  const importLines = [];

  const expressTypes = ["Router","type IRouter","type Request","type Response"];
  if (usesNextFunction) expressTypes.push("type NextFunction");
  importLines.push(`import { ${expressTypes.join(", ")} } from "express";`);

  if (usedDrizzle.length > 0)
    importLines.push(`import { ${usedDrizzle.join(", ")} } from "drizzle-orm";`);

  if (usedTables.length > 0)
    importLines.push(`import { db, ${usedTables.join(", ")} } from "@workspace/db";`);
  else
    importLines.push(`import { db } from "@workspace/db";`);

  if (usesRequireEnota)
    importLines.push(`import { requireEnota } from "../../middlewares/pos";`);
  if (usesBroadcast)
    importLines.push(`import { broadcast } from "../../lib/pos-sse";`);
  if (usesRecompute)
    importLines.push(`import { recomputeZaloge } from "../../lib/pos-zaloge-utils";`);
  if (fursFns.length > 0)
    importLines.push(`import { ${fursFns.join(", ")} } from "../../lib/pos-furs";`);
  if (usesLogger)
    importLines.push(`import { logger } from "../../lib/logger";`);
  if (usesUpsertKupec)
    importLines.push(`import { upsertPogostKupec } from "./kupec";`);

  // bcrypt stays in files that actually need it
  if (file === "nastavitve.ts" || file === "racuni.ts")
    importLines.push(`import bcrypt from "bcryptjs";`);

  const newContent = importLines.join("\n") + "\n\n" + content;
  await writeFile(filePath, newContent, "utf-8");
  console.log(`✅ ${file}: tables=${usedTables.length}, drizzle=${usedDrizzle.length}, furs=${fursFns.length}`);
}

console.log("\nVse POS rute popravljene.");
