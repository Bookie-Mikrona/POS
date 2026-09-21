export const UNIT_CAPABILITIES = [
  "tables", "checkout", "shifts", "receipts", "kitchen", "bar",
  "prepared_food", "plate_waste", "menu", "inventory", "statistics",
  "operational_reports", "realization", "journals", "cash_movements",
  "hours", "simulation", "settings", "reservations", "delivery",
  "phone_orders", "qr_menu", "multi_course", "self_service",
  "events", "stock_transfers", "deposits_tokens",
] as const;

export type UnitCapability = typeof UNIT_CAPABILITIES[number];
export type HospitalityProfile =
  | "restaurant" | "inn" | "fine_dining" | "self_service" | "fast_food"
  | "bar" | "cafe_pastry" | "tourist_farm" | "festival_society"
  | "event_stall" | "catering_celebrations" | "food_truck"
  | "hotel_food_service";
export type ServiceMode = "table_service" | "counter" | "self_service" | "mobile_event" | "catering" | "mixed";

export const SERVICE_MODE_LABELS: Record<ServiceMode, string> = {
  table_service: "Strežba pri mizi",
  counter: "Postrežba pri pultu",
  self_service: "Samopostrežba / ruski šank",
  mobile_event: "Mobilna ali prireditvena prodaja",
  catering: "Catering in dogodki",
  mixed: "Kombiniran način",
};

export const CAPABILITY_LABELS: Record<UnitCapability, string> = {
  tables: "Mize in prostori",
  checkout: "Blagajna",
  shifts: "Izmene",
  receipts: "Računi",
  kitchen: "Kuhinja / KDS",
  bar: "Točilnica",
  prepared_food: "Pripravljena hrana",
  plate_waste: "Odpadki s krožnikov",
  menu: "Meni in ceniki",
  inventory: "Zaloge in inventure",
  statistics: "Statistike",
  operational_reports: "Operativna poročila",
  realization: "Realizacija",
  journals: "Temeljnice",
  cash_movements: "Blagajniški premiki",
  hours: "Obračun ur",
  simulation: "Simulacija",
  settings: "Nastavitve",
  reservations: "Rezervacije",
  delivery: "Dostava in prevzem",
  phone_orders: "Telefonska naročila",
  qr_menu: "QR-meni",
  multi_course: "Večhodni meniji",
  self_service: "Samopostrežna ponudba",
  events: "Dogodki in slavja",
  stock_transfers: "Prenosi zaloge",
  deposits_tokens: "Kavcije, boni in žetoni",
};

type ProfileDefinition = {
  label: string;
  description: string;
  capabilities: UnitCapability[];
  temporary?: boolean;
  serviceMode: ServiceMode;
};

const common: UnitCapability[] = [
  "checkout", "shifts", "receipts", "menu", "inventory", "statistics",
  "operational_reports", "realization", "journals", "cash_movements",
  "hours", "settings",
];

const profile = (
  label: string,
  description: string,
  capabilities: UnitCapability[],
  temporary = false,
  serviceMode: ServiceMode = "mixed",
): ProfileDefinition => ({
  label,
  description,
  capabilities: [...new Set([...common, ...capabilities])],
  temporary,
  serviceMode,
});

export const HOSPITALITY_PROFILES: Record<HospitalityProfile, ProfileDefinition> = {
  restaurant: profile("Restavracija", "Celovita strežba pri mizah s kuhinjo in točilnico.", ["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "delivery", "phone_orders", "qr_menu"], false, "table_service"),
  inn: profile("Gostilna / gostišče", "Tradicionalna ponudba, dnevna kosila, skupine in slavja.", ["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "events", "delivery", "qr_menu"], false, "table_service"),
  fine_dining: profile("Fine dining", "Večhodni meniji, rezervacije in usklajena strežba hodov.", ["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "multi_course", "events"], false, "table_service"),
  self_service: profile("Samopostrežna restavracija", "Ruski šank, dnevna ponudba in hitra blagajna.", ["kitchen", "prepared_food", "plate_waste", "self_service"], false, "self_service"),
  fast_food: profile("Hitra prehrana / kiosk", "Hitra prodaja, KDS, prevzem in dostava.", ["kitchen", "prepared_food", "delivery", "phone_orders", "qr_menu"], false, "counter"),
  bar: profile("Bar / bife / pub", "Točilnica, odprti računi in pijačna ponudba.", ["tables", "bar", "qr_menu"], false, "mixed"),
  cafe_pastry: profile("Kavarna / slaščičarna", "Napitki, vitrina, sladice in prednaročila.", ["tables", "bar", "prepared_food", "qr_menu", "phone_orders"], false, "table_service"),
  tourist_farm: profile("Turistična kmetija / osmica", "Sezonska ponudba, skupine in domači izdelki.", ["tables", "kitchen", "bar", "prepared_food", "reservations", "events"], false, "table_service"),
  festival_society: profile("Društvo / veselica", "Začasna prireditev z več prodajnimi mesti, boni in kavcijami.", ["kitchen", "bar", "events", "stock_transfers", "deposits_tokens"], true, "mobile_event"),
  event_stall: profile("Prireditvena stojnica", "Začasna prodajna točka z lastnim cenikom in zalogo.", ["kitchen", "bar", "events", "stock_transfers", "deposits_tokens"], true, "mobile_event"),
  catering_celebrations: profile("Pogostitve in slavja", "Poroke, rojstni dnevi, catering in obračun dogodka.", ["tables", "kitchen", "bar", "reservations", "multi_course", "events", "stock_transfers"], false, "catering"),
  food_truck: profile("Food truck / prikolica / kombi", "Premična hitra prodaja z omejeno zalogo in lokacijami.", ["kitchen", "prepared_food", "events", "stock_transfers", "delivery"], true, "mobile_event"),
  hotel_food_service: profile("Hotelska gostinska ponudba", "Zajtrk, restavracija, bar in sobna postrežba.", ["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "self_service"], false, "mixed"),
};

export const ALL_UNIT_CAPABILITIES = [...UNIT_CAPABILITIES];

export function profileDefaults(profileKey: HospitalityProfile): ProfileDefinition {
  return HOSPITALITY_PROFILES[profileKey] ?? HOSPITALITY_PROFILES.restaurant;
}

export const NAV_CAPABILITY_BY_PATH: Record<string, UnitCapability> = {
  "/": "tables",
  "/blagajna": "checkout",
  "/izmene": "shifts",
  "/racuni": "receipts",
  "/kuhinja": "kitchen",
  "/tocilnica": "bar",
  "/pripravljena-hrana": "prepared_food",
  "/odpadki-s-kroznikov": "plate_waste",
  "/meni": "menu",
  "/zaloge": "inventory",
  "/statistike": "statistics",
  "/operativna-porocila": "operational_reports",
  "/realizacija": "realization",
  "/temeljnice": "journals",
  "/blagajniski-premiki": "cash_movements",
  "/obracun-ur": "hours",
  "/simulacija": "simulation",
  "/nastavitve": "settings",
  "/narocniki": "phone_orders",
  "/dogodki": "events",
};