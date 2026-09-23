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
  { id: "03", number: 3, title: "Meni, artikli in normativi", description: "Nastavitve menija, kategorij, izdelkov, upravljanje cen, alergenov in normativov.", roles: ["vodja", "admin"], topics: ["meni", "artikli"] },
  { id: "04", number: 4, title: "Zaloge in dokumenti", description: "Vodenje zalog, prevzem blaga, odpis in inventure. Upravljanje skladišča.", roles: ["vodja", "admin"], topics: ["zaloge", "dokumenti"] },
  { id: "05", number: 5, title: "Pripravljena hrana, QR in telefonska naročila", description: "Obravnava specifičnih vrst prodaje - od vnaprej pripravljene hrane do oddaljenih naročil.", roles: ["natakar", "vodja"], topics: ["prodaja", "specialno"] },
  { id: "06", number: 6, title: "Izmene, poročila in nastavitve", description: "Zaključki izmen, dnevni izkazi, pregled prometa, davčno potrjevanje in tiskanje.", roles: ["vodja", "admin"], topics: ["porocila", "fiskalizacija"] },
  { id: "07", number: 7, title: "Začetek dela in napredno usmerjanje", description: "Napredni prikazi KDS, delo s tiskalniki in postajami (kuhinja, šank, izdaja).", roles: ["natakar", "kuhinja"], topics: ["kds", "napredno"] },
  { id: "08", number: 8, title: "Nastavitve po sklopih", description: "Podrobna konfiguracija celotnega sistema, enot, blagajn in uporabniških pravic.", roles: ["admin"], topics: ["nastavitve"] },
  { id: "09", number: 9, title: "Postopki po vlogah", description: "Standardni operativni postopki (SOP) specifični za vsako posamezno vlogo v lokalu.", roles: ["natakar", "kuhinja", "vodja", "admin"], topics: ["sop"] },
  { id: "10", number: 10, title: "Odločitvena drevesa in kontrolni seznami", description: "Pomoč pri odpravljanju težav in kontrolni seznami za odpiranje/zapiranje lokala.", roles: ["vodja", "admin"], topics: ["troubleshooting", "checklists"] },
  { id: "11", number: 11, title: "Vnos, uvoz prejemnic in OCR", description: "Avtomatizacija vnašanja prejemnic prek OCR prepoznave in uvozi podatkov.", roles: ["vodja", "admin"], topics: ["zaloge", "ocr"] },
  { id: "12", number: 12, title: "Spremembe in dopolnitve", description: "Pregled posodobitev sistema in revizijska sled sprememb priročnika.", roles: ["admin"], topics: ["posodobitve"] },
];