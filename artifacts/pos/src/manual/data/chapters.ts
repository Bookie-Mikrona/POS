export interface Chapter {
  id: string;
  number: number;
  title: string;
  description: string;
  roles: string[];
  topics: string[];
}

export const manualChapters: Chapter[] = [
  { id: "01", number: 1, title: "Dostop in priprava sistema", description: "Prijava in varen dostop do POS, preverjanje delovnega konteksta, naprav in osnovnih funkcionalnosti pričetka.", roles: ["natakar", "vodja", "admin"], topics: ["prijava", "osnove"] },
  { id: "02", number: 2, title: "Začetek izmene in delovno okolje", description: "Odpiranje osebne izmene, prevzem blagajne, preverjanje miz in začetnega denarja.", roles: ["natakar", "vodja"], topics: ["izmena", "blagajna"] },
  { id: "03", number: 3, title: "Mize, rezervacije in naročila", description: "Izbira mize, sprejem in urejanje naročil ter rezervacije.", roles: ["natakar", "vodja"], topics: ["mize", "narocila"] },
  { id: "04", number: 4, title: "Meni, artikli, normativi in alergeni", description: "Šifrant, katalogi PDF, Excel uvoz, samodejni normativi pijač, polizdelki na kg/l, pice, modifikatorji in alergeni.", roles: ["vodja", "admin"], topics: ["meni", "artikli", "normativi", "pijače", "excel", "katalogi", "polizdelki"] },
  { id: "05", number: 5, title: "Priprava, KDS, QR meni in telefonska naročila", description: "Stanja priprave, zvočna obvestila KDS, razpoložljivost ter QR in telefonska naročila.", roles: ["natakar", "kuhinja", "vodja"], topics: ["kds", "qr", "telefon", "obvestila", "razpoložljivost"] },
  { id: "06", number: 6, title: "Plačilo, račun, FURS in tisk", description: "Plačila, FURS, tisk, To Go, mesečni računi pogodbenim firmam, e-SLOG in dostava prek bizBox.", roles: ["natakar", "vodja", "admin"], topics: ["placila", "fiskalizacija", "mesečni računi", "malice", "e-slog", "bizbox", "embalaža"] },
  { id: "07", number: 7, title: "Zaloge, prejemnice, OCR, pripravljena hrana, odpad in dogodki", description: "Prevzemi, inventure, OCR, pripravljena hrana v porcijah/kg/l, poraba, kalo, DDV, tuja valuta in pregled osnovnih sredstev.", roles: ["vodja", "admin"], topics: ["zaloge", "ocr", "dogodki", "poraba", "pripravljena hrana", "valuta", "ddv", "osnovna sredstva"] },
  { id: "08", number: 8, title: "Konec izmene, blagajniški premiki, poročila in POS→ERP", description: "Zaključevanje izmen, blagajniški premiki, poročila in povezava z ERP.", roles: ["vodja", "admin"], topics: ["izmena", "porocila"] },
  { id: "09", number: 9, title: "Nastavitve, naprave, uporabniki in varnost", description: "Nastavitve, naprave, vloge in varnost; platformna prijava, operativna enota ter osveževanje konteksta.", roles: ["vodja", "admin"], topics: ["nastavitve", "naprave", "superadmin", "e-pošta", "sinhronizacija"] },
  { id: "10", number: 10, title: "Hitri postopki po vlogah", description: "Kontrolni koraki za različne delovne odgovornosti v lokalu.", roles: ["natakar", "kuhinja", "vodja", "admin"], topics: ["sop"] },
  { id: "11", number: 11, title: "Odpravljanje težav in izredni primeri", description: "Varni koraki ob težavah s plačili, naročili, zalogo in napravami.", roles: ["natakar", "vodja", "admin"], topics: ["tezave", "kontrolni-seznami"] },
  { id: "12", number: 12, title: "Slovar, kontrolni seznami in kratka zgodovina različice", description: "Razlaga izrazov, kontrolni seznami in usmeritve za trenutne postopke.", roles: ["natakar", "vodja", "admin"], topics: ["slovar", "kontrolni-seznami"] },
];