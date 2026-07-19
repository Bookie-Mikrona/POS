/**
 * POS Gostinstvo — schema indeks.
 * Vse POS tabele so vezane na ERP podjetje prek enote:
 *   company (ERP) → enota (POS lokacija) → vse POS tabele
 */
export * from "./enote";
export * from "./kategorije";
export * from "./artikli";
export * from "./modifikatorji";
export * from "./normativi";
export * from "./prostori";
export * from "./mize";
export * from "./natakari";
export * from "./izmene";
export * from "./narocila";
export * from "./racuni";
export * from "./blagajne";
export * from "./poslovni-prostori";
export * from "./nastavitve";
export * from "./naprave";
export * from "./zaloge";
export * from "./prejemnice";
export * from "./inventure";
export * from "./zacetne-zaloge";
export * from "./shranjeni-kupci";
export * from "./viva-vracila";
export * from "./tiskalne-naloge";
export * from "./glasovni-sinonimi";
export * from "./dnevni-meni";
export * from "./partner-ceniki";
export * from "./uporabniki";
