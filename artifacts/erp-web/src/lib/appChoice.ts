/** Superadmin po prijavi izbere aplikacijo (ERP ali POS); izbira velja za to sejo brskalnika. */
const KEY = "superadmin_app_choice_done";

export function isAppChoiceDone(): boolean {
  return sessionStorage.getItem(KEY) === "1";
}
export function markAppChoiceDone(): void {
  sessionStorage.setItem(KEY, "1");
}
export function resetAppChoice(): void {
  sessionStorage.removeItem(KEY);
}
