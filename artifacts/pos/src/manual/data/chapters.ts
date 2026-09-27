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
  { id: "04", number: 4, title: "Meni, artikli, normativi in alergeni", description: "Šifrant artiklov, drobni inventar, cene, normativi in alergenski podatki.", roles: ["vodja", "admin"], topics: ["meni", "artikli"] },
  { id: "05", number: 5, title: "Priprava, KDS, QR meni in telefonska naročila", description: "Priprava naročil in obravnava QR ter telefonskih naročil.", roles: ["natakar", "kuhinja", "vodja"], topics: ["kds", "qr", "telefon"] },
  { id: "06", number: 6, title: "Plačilo, račun, FURS in tisk", description: "Plačila, davčno potrjevanje računov, povračila in tisk.", roles: ["natakar", "vodja", "admin"], topics: ["placila", "fiskalizacija"] },
  { id: "07", number: 7, title: "Zaloge, prejemnice, OCR, pripravljena hrana, odpad in dogodki", description: "Prevzemi, inventure, OCR popisnega lista, pripravljena hrana in dogodki.", roles: ["vodja", "admin"], topics: ["zaloge", "ocr", "dogodki"] },
  { id: "08", number: 8, title: "Konec izmene, blagajniški premiki, poročila in POS→ERP", description: "Zaključevanje izmen, blagajniški premiki, poročila in povezava z ERP.", roles: ["vodja", "admin"], topics: ["izmena", "porocila"] },
  { id: "09", number: 9, title: "Nastavitve, naprave, uporabniki in varnost", description: "Nastavitve enot, naprav, uporabniških vlog in varnosti.", roles: ["vodja", "admin"], topics: ["nastavitve", "naprave"] },
  { id: "10", number: 10, title: "Hitri postopki po vlogah", description: "Kontrolni koraki za različne delovne odgovornosti v lokalu.", roles: ["natakar", "kuhinja", "vodja", "admin"], topics: ["sop"] },
  { id: "11", number: 11, title: "Odpravljanje težav in izredni primeri", description: "Varni koraki ob težavah s plačili, naročili, zalogo in napravami.", roles: ["natakar", "vodja", "admin"], topics: ["tezave", "kontrolni-seznami"] },
  { id: "12", number: 12, title: "Slovar, kontrolni seznami in kratka zgodovina različice", description: "Razlaga izrazov, kontrolni seznami in usmeritve za trenutne postopke.", roles: ["natakar", "vodja", "admin"], topics: ["slovar", "kontrolni-seznami"] },
];