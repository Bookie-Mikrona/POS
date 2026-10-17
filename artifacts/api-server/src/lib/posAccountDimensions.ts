interface DimensionAccount {
  code: string;
  requiresPartner?: boolean | null;
  requiresCostCenter?: boolean | null;
  requiresProject?: boolean | null;
}

export function posAccountDimensionWarning(
  account: DimensionAccount,
  line?: { partnerId?: string | null; costCenterId?: string | null; projectId?: string | null },
): string | null {
  const missing = [
    account.requiresPartner && !line?.partnerId ? "partnerja" : null,
    account.requiresCostCenter && !line?.costCenterId ? "stroškovno mesto" : null,
    account.requiresProject && !line?.projectId ? "projekt" : null,
  ].filter(Boolean);
  return missing.length
    ? `Konto ${account.code} zahteva ${missing.join(", ")} — osnutka brez zahtevane dimenzije ni mogoče neposredno potrditi.`
    : null;
}
