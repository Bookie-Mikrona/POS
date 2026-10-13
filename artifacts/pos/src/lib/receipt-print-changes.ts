type EditableReceipt = {
  placilnaNacin: string;
  znesekGotovina?: number | null;
  znesekKartica?: number | null;
  znesekBon?: number | null;
  znesekBonPica?: number | null;
  steviloBonov?: number | null;
  kupecDavcnaStevilka?: string | null;
  kupecNaziv?: string | null;
  kupecNaslov?: string | null;
};

/** PATCH je potreben samo za dejanski popravek, ne za tisk nespremenjene kopije. */
export function hasReceiptPrintChanges(original: EditableReceipt, update: EditableReceipt): boolean {
  if (update.placilnaNacin !== original.placilnaNacin) return true;
  for (const key of ["znesekGotovina", "znesekKartica", "znesekBon", "znesekBonPica"] as const) {
    if (update[key] !== undefined &&
      Math.round((update[key] ?? 0) * 100) !== Math.round((original[key] ?? 0) * 100)) return true;
  }
  if (update.steviloBonov !== undefined &&
    (update.steviloBonov ?? 0) !== (original.steviloBonov ?? 0)) return true;
  for (const key of ["kupecDavcnaStevilka", "kupecNaziv", "kupecNaslov"] as const) {
    if (update[key] !== undefined && (update[key] ?? "") !== (original[key] ?? "")) return true;
  }
  return false;
}
