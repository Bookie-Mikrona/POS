type EmbalazaBilancaRow = {
  artikelId: number;
  artikelIme: string;
  vrstaEmbalaze: string | null;
  dobaviteljId: string | null;
  dobaviteljIme: string | null;
  fizicnaZaloga: string | null;
  kolicina: string | null;
  depozitnaVrednost: string | null;
};

export function normalizeEmbalazaBilanca(row: EmbalazaBilancaRow) {
  const fizicnaKolicina = Number(row.kolicina ?? 0);
  const depozitnaVrednost = row.depozitnaVrednost == null
    ? null
    : Number(row.depozitnaVrednost);

  return {
    ...row,
    supplierUuid: row.dobaviteljId,
    fizicnaKolicina,
    overallPhysicalStock: Number(row.fizicnaZaloga ?? 0),
    depozitnaVrednost,
    izpostavljenostDepozita: fizicnaKolicina * (depozitnaVrednost ?? 0),
  };
}