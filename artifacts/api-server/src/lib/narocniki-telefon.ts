/**
 * Normalizacija slovenskih telefonskih številk za ključ naročnika.
 *
 * Podprti so lokalni zapisi (040 123 456, 040123456, 40123456),
 * slovenski mednarodni zapis (+38640123456) in zapis z 00 (+386...).
 */
export function normalizirajTelefon(telefon: string): string {
  const vhod = String(telefon ?? "").trim();
  if (!vhod) throw new Error("Telefonska številka je obvezna");

  let digits = vhod.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("386")) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Slovenska nacionalna številka brez vodilne ničle ima praviloma 8 mest.
  if (!/^\d{8}$/.test(digits)) {
    throw new Error("Telefonska številka mora biti veljavna slovenska številka");
  }
  return `+386${digits}`;
}