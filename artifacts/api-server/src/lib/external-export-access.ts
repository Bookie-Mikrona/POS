export function isExternalExportAccessAllowed(
  accountingRole: "owner" | "accountant" | "viewer" | null | undefined,
  posRole: string | null | undefined,
): boolean {
  return posRole === "admin" || (accountingRole !== null && accountingRole !== undefined && accountingRole !== "viewer");
}