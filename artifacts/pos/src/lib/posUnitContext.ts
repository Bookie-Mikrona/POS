/** Platform administrators are not an operational POS unit session. */
export function hasActivePosUnit(user: { vloga?: string; enotaId?: number | null } | null | undefined): boolean {
  return user?.vloga !== "superadmin" && Number.isInteger(user?.enotaId) && (user?.enotaId ?? 0) > 0;
}