import { pgTable, text, serial, timestamp, index, unique } from "drizzle-orm/pg-core";

/**
 * UJP seznam proračunskih uporabnikov prejemnikov e-računov.
 * Vir: https://storitve.ujp.gov.si/docdir/eracunpu/eRacunPU_Dnevni.txt
 * Format: SifraPu;TrrSt;PopolniNaziv;MaticnaSt;DavcnaSt
 *
 * Eden subjekt ima lahko več TRR-jev (več vrstic z isto davcnaSt).
 * TrrSt = e-naslov za dostavo UJP e-računov (15-mestna številka).
 */
export const ujpPrejemnikiTable = pgTable("ujp_prejemniki", {
  id: serial("id").primaryKey(),
  sifraPu: text("sifra_pu").notNull(),
  trrSt: text("trr_st").notNull(),           // 15-mestna TRR številka (e-naslov)
  naziv: text("naziv").notNull(),
  maticnaSt: text("maticna_st").notNull(),
  davcnaSt: text("davcna_st").notNull(),      // 8 cifer, brez SI
  zadnjiUvoz: timestamp("zadnji_uvoz", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique("ujp_sifra_trr_unique").on(t.sifraPu, t.trrSt),
  index("ujp_davcna_idx").on(t.davcnaSt),
  index("ujp_maticna_idx").on(t.maticnaSt),
]);

export type UjpPrejemnik = typeof ujpPrejemnikiTable.$inferSelect;
