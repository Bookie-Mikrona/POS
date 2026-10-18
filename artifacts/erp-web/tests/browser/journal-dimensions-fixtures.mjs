export const companyId = "synthetic-journal-company";
export const period = {
  id: "synthetic-period", name: "Sintetično obdobje 2026", status: "open",
  startDate: "2026-01-01", endDate: "2026-12-31",
};

export const dimensions = {
  costCenterNames: [
    "Osrednja kuhinja in priprava gostinskih jedi za zunanje naročnike",
    "Stroškovno mesto poslovne enote s posebno dolgo oznako lokacije",
    "Organizacija in izvedba večjih dogodkov ter spremljajočih storitev",
  ],
  projectNames: [
    "Celovita prenova gostinskega obrata in posodobitev kuhinjske opreme",
    "Razvoj ponudbe za poslovne goste in mednarodne konference",
    "Dolgoročni projekt trajnostnega poslovanja in zmanjševanja odpadkov",
  ],
  departmentNames: [
    "Oddelek za organizacijo dogodkov in sodelovanje s poslovnimi partnerji",
    "Oddelek priprave jedi in zagotavljanja kakovosti gostinskih storitev",
    "Oddelek upravljanja poslovnih enot in podpornih dejavnosti",
  ],
};

const base = {
  companyId, periodId: period.id, periodName: period.name,
  entryDate: "2026-10-18", status: "posted", sourceType: "manual",
  totalDebit: "1234.56", totalCredit: "1234.56",
  createdAt: "2026-10-18T12:00:00Z",
};

// Oldest first, just like the list API. Include both empty and absent arrays.
export const entries = [
  { ...base, id: "empty-dimensions", description: "Temeljnica brez dimenzij",
    reference: "BREZ-2026-001", costCenterNames: [], projectNames: [], departmentNames: [] },
  { ...base, id: "legacy-dimensions", description: "Starejša temeljnica brez polj dimenzij",
    reference: "STARA-2026-002", status: "draft" },
  { ...base, ...dimensions, id: "many-long-dimensions",
    description: "Temeljnica z mnogimi dolgimi dimenzijami", reference: "DOLGE-2026-003" },
];

export const dimensionGroups = [
  ["Stroškovno mesto", dimensions.costCenterNames],
  ["Projekt", dimensions.projectNames],
  ["Oddelek", dimensions.departmentNames],
];
