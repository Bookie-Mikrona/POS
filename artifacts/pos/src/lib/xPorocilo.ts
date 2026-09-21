export interface XPorociloPromet {
  skupajPromet: number;
  skupajDDV: number;
  prometPoNacinuPlacila: {
    gotovina: number;
    kartica: number;
    bon: number;
    sumup: number;
    bonPica: number;
    steviloBonov: number;
    negotovinsko: number;
    napitnina: number;
    reprezentanca: number;
    lastna_poraba: number;
  };
  prometPoBlagajnah: {
    blagajnaKoda: string;
    skupaj: number;
    steviloRacunov: number;
    odZap: string | null;
    doZap: string | null;
  }[];
  prometPoNatakarjih: {
    natakarIme: string;
    skupaj: number;
    gotovina: number;
    kartica: number;
    sumup: number;
    bon: number;
    bonPica: number;
    steviloBonov: number;
    steviloRacunov: number;
  }[];
  ddvPoStopnjah: { stopnja: number; ddvZnesek: number; osnova: number }[];
  prihodkiPoVrsti: { storitve: number; blago: number; material: number };
  izdaniKuponi: number;
  prejetiKuponi: number;
  podjetje: { naziv: string; naslov: string; davcnaStevilka: string };
  enota: { id: number; ime: string };
}

export interface XPorociloStanje {
  menjalniDenar: number;
  gotovinskaProdaja: number;
  pologiGotovine: number;
  izplacilaDobaviteljem: number;
  pologiTrr: number;
  stanje: number;
}

export interface XPorociloPremik {
  id: string;
  datumCas: string;
  tip: string;
  status: "OSNUTEK" | "POTRJEN" | "STORNIRAN";
  znesek: number;
  opis: string;
  partnerNaziv: string | null;
}

const STATUS_LABEL: Record<XPorociloPremik["status"], string> = {
  OSNUTEK: "OSNUTEK (NEKNJIZEN)",
  POTRJEN: "POTRJEN",
  STORNIRAN: "STORNIRAN",
};

const TIP_LABEL: Record<string, string> = {
  IZPLACILO_DOBAVITELJU: "Izplacilo dobavitelju",
  POLOG_GOTOVINE: "Prejem gotovine",
  DVIG_GOTOVINE: "Dvig s TRR",
  POLOG_TRR: "Polog na TRR",
  PRILIV_TRR: "Priliv na TRR",
  STORNO: "Storno premika",
};

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}.`;
}

function column(value: string, width: number, align: "left" | "right" = "left"): string {
  if (width <= 0) return "";
  const text = truncate(value, width);
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

function columns(width: number, cells: { value: string; width: number; align?: "left" | "right" }[]): string {
  return cells.map((cell) => column(cell.value, cell.width, cell.align)).join(" ").slice(0, width);
}

export function formatXPorociloPrintLines(input: {
  width: number;
  datum: string;
  printedAt: string;
  promet: XPorociloPromet;
  stanje: XPorociloStanje;
  premiki: XPorociloPremik[];
}): string[] {
  const { width, datum, printedAt, promet, stanje, premiki } = input;
  const eur = (value: number) => `${value < 0 ? "-" : " "}${Math.abs(value).toFixed(2)} EUR`;
  const row = (label: string, value: string) => {
    const safeValue = truncate(value, Math.max(1, width - 1));
    const labelWidth = width - safeValue.length;
    return `${truncate(label, labelWidth).padEnd(labelWidth)}${safeValue}`;
  };
  const separator = "-".repeat(width);
  const ddvRows = promet.ddvPoStopnjah.flatMap((item) => {
    const label = `DDV ${item.stopnja.toFixed(1).replace(".", ",")}%`;
    return [row(`${label} osnova:`, eur(item.osnova)), row(`${label} DDV:`, eur(item.ddvZnesek))];
  });
  const payment = promet.prometPoNacinuPlacila;
  const registerAmountWidth = 11;
  const registerCountWidth = 6;
  const registerCodeWidth = Math.max(1, width - registerAmountWidth - registerCountWidth - 2);
  const cashRegisterRows = promet.prometPoBlagajnah.flatMap((blagajna, index) => [
    ...(index === 0
      ? [columns(width, [
        { value: "Blagajna", width: registerCodeWidth },
        { value: "Rac.", width: registerCountWidth, align: "right" },
        { value: "Znesek", width: registerAmountWidth, align: "right" },
      ])]
      : []),
    columns(width, [
      { value: blagajna.blagajnaKoda, width: registerCodeWidth },
      { value: String(blagajna.steviloRacunov), width: registerCountWidth, align: "right" },
      { value: eur(blagajna.skupaj), width: registerAmountWidth, align: "right" },
    ]),
    ...(blagajna.odZap ? [row("Racuni:", `${blagajna.odZap} - ${blagajna.doZap ?? ""}`)] : []),
  ]);
  const staffRows = promet.prometPoNatakarjih.flatMap((natakar) => [
    truncate(`Prodajalec: ${natakar.natakarIme}`, width),
    row("Skupaj:", eur(natakar.skupaj)),
    row("Gotovina:", eur(natakar.gotovina)),
    row("Kartica:", eur(natakar.kartica)),
    ...(natakar.sumup > 0 ? [row("SumUp:", eur(natakar.sumup))] : []),
    ...(natakar.bon > 0 ? [row("Bon:", eur(natakar.bon))] : []),
  ]);
  const virtualRows = payment.reprezentanca > 0 || payment.lastna_poraba > 0
    ? [
      separator,
      "NAVIDEZNI PROMET",
      ...(payment.reprezentanca > 0 ? [row("Reprezentanca:", eur(payment.reprezentanca))] : []),
      ...(payment.lastna_poraba > 0 ? [row("Lastna poraba:", eur(payment.lastna_poraba))] : []),
    ]
    : [];
  const movementRows = premiki.length === 0
    ? ["Ni blagajniskih premikov."]
    : premiki.flatMap((movement) => {
      const time = new Date(movement.datumCas).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
      const headline = row(`${time} ${STATUS_LABEL[movement.status]}:`, eur(movement.znesek));
      const detail = truncate(`${TIP_LABEL[movement.tip] ?? movement.tip} — ${movement.opis}`, width);
      const partner = movement.partnerNaziv ? truncate(`Dobavitelj: ${movement.partnerNaziv}`, width) : null;
      return [headline, detail, ...(partner ? [partner] : [])];
    });

  return [
    ...(promet.podjetje.naziv ? [promet.podjetje.naziv] : []),
    ...(promet.podjetje.naslov ? [promet.podjetje.naslov] : []),
    ...(promet.podjetje.davcnaStevilka ? [`ID DDV:${promet.podjetje.davcnaStevilka}`] : []),
    ...(promet.enota.ime ? [truncate(`Poslovna enota: ${promet.enota.ime}`, width)] : [`Poslovna enota ID: ${promet.enota.id}`]),
    separator,
    "X-POROČILO",
    row("Poslovni dan:", datum),
    row("Natisnjeno:", printedAt),
    separator,
    row("Prodajni promet:", eur(promet.skupajPromet)),
    row("Gotovina:", eur(payment.gotovina)),
    row("Kartica (bremenitev):", eur(payment.kartica)),
    ...(payment.napitnina !== 0 ? [row("Napitnine (ločeno):", eur(payment.napitnina))] : []),
    ...(payment.sumup > 0 ? [row("SumUp:", eur(payment.sumup))] : []),
    row("Bon:", eur(payment.bon)),
    ...(payment.bonPica > 0 ? [row("Bon pica:", eur(payment.bonPica))] : []),
    ...(payment.negotovinsko > 0 ? [row("TRR:", eur(payment.negotovinsko))] : []),
    ...virtualRows,
    ...(cashRegisterRows.length > 0 ? [separator, "PROMET IZBRANE BLAGAJNE", ...cashRegisterRows] : []),
    ...(staffRows.length > 0 ? [separator, "PROMET PO PRODAJALCU", ...staffRows] : []),
    separator,
    "BLAGAJNISKI DNEVNIK",
    "GIBANJE GOTOVINE",
    row("Zacetno - menjalni:", eur(stanje.menjalniDenar)),
    row("+ Gotovinska prodaja:", eur(stanje.gotovinskaProdaja)),
    row("+ Prejemi gotovine:", eur(stanje.pologiGotovine)),
    row("- Izplacila dobav.:", eur(stanje.izplacilaDobaviteljem)),
    row("- Pologi na TRR:", eur(stanje.pologiTrr)),
    separator,
    row("Teoreticno stanje:", eur(stanje.stanje)),
    separator,
    "DNEVNIK PREMIKOV",
    ...movementRows,
    separator,
    "DDV PO STOPNJAH",
    ...(ddvRows.length > 0 ? ddvRows : [row("DDV:", eur(promet.skupajDDV))]),
    separator,
    "PRIHODKI PO VRSTI (NETO)",
    row("Storitve:", eur(promet.prihodkiPoVrsti.storitve)),
    row("Blago:", eur(promet.prihodkiPoVrsti.blago)),
    row("Material:", eur(promet.prihodkiPoVrsti.material)),
    ...(promet.izdaniKuponi > 0 || promet.prejetiKuponi > 0
      ? [separator, "BONI ZA PICO", row("Izdani kuponi:", String(promet.izdaniKuponi)), row("Prejeti kuponi:", String(promet.prejetiKuponi))]
      : []),
  ];
}