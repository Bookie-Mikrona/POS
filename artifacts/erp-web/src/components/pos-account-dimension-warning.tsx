export interface AccountDimensions {
  requiresPartner?: boolean;
  requiresCostCenter?: boolean;
  requiresProject?: boolean;
}

export function PosAccountDimensionWarning({ account }: { account?: AccountDimensions }) {
  const dimensions = [
    account?.requiresPartner ? "partnerja" : null,
    account?.requiresCostCenter ? "stroškovno mesto" : null,
    account?.requiresProject ? "projekt" : null,
  ].filter(Boolean);
  if (!dimensions.length) return null;
  return (
    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
      Ta konto zahteva {dimensions.join(", ")} — samodejno knjiženje bo ustvarilo osnutke
      brez dimenzije in jih ne bo mogoče neposredno potrditi. Če je zahtevana dimenzija
      že samodejno izpolnjena, dopolnitev ni potrebna.
    </p>
  );
}
