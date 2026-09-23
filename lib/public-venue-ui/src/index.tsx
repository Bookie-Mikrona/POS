import { useState, type CSSProperties, type ReactNode } from "react";
import type { JavnaRestavracija } from "@workspace/api-client-react";
import { CalendarDays, Gift, Mail, MapPin, Phone } from "lucide-react";

export type PreviewVoucherProduct = {
  id?: string;
  naziv: string;
  opis?: string | null;
  imageUrl?: string | null;
  active: boolean;
  variants: Array<{
    id?: string;
    naziv: string;
    amountCents: number;
    active: boolean;
  }>;
};

type PublicVenueViewProps = {
  restaurant: JavnaRestavracija;
  reservationContent?: ReactNode;
  voucherContent?: ReactNode;
  preview?: boolean;
  previewProducts?: PreviewVoucherProduct[];
};

const days = ["Ponedeljek", "Torek", "Sreda", "Četrtek", "Petek", "Sobota", "Nedelja"];
const publicVenueTheme = {
  "--background": "40 33% 96%",
  "--foreground": "160 10% 15%",
  "--border": "40 15% 85%",
  "--card": "40 33% 98%",
  "--card-foreground": "160 10% 15%",
  "--card-border": "40 15% 85%",
  "--muted": "40 20% 90%",
  "--muted-foreground": "160 10% 40%",
  "--primary": "160 38% 17%",
  "--primary-foreground": "40 33% 96%",
} as CSSProperties;

export function PublicVenueView({
  restaurant,
  reservationContent,
  voucherContent,
  preview = false,
  previewProducts = [],
}: PublicVenueViewProps) {
  const [activeTab, setActiveTab] = useState<"rezervacija" | "boni">("rezervacija");
  const { kontakt, openingHours } = restaurant;
  const publicPrimary = restaurant.branding?.primaryColor || "#1B3B36";
  const visibleProducts = previewProducts.filter(product => product.active);

  return (
    <div
      className="@container min-h-screen bg-background text-foreground pb-24"
      style={{
        ...publicVenueTheme,
        "--public-primary": publicPrimary,
        fontFamily: "'Inter', sans-serif",
      } as CSSProperties}
      data-testid={preview ? "public-venue-draft-preview" : "public-venue-view"}
    >
      {preview ? (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-900 shadow-sm" data-testid="status-draft-preview">
          Osnutek · spremembe še niso objavljene
        </div>
      ) : null}

      <div className="relative flex h-64 w-full items-center justify-center overflow-hidden bg-muted @min-[768px]:h-80">
        {restaurant.branding?.coverImageUrl ? (
          <img src={restaurant.branding.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" data-testid="img-cover" />
        ) : null}
        <div className="absolute inset-0" style={{ backgroundColor: `${publicPrimary}22` }} />
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />

        <div className="relative z-10 mt-20 px-4 text-center">
          {restaurant.branding?.logoUrl ? (
            <img
              src={restaurant.branding.logoUrl}
              alt={`${restaurant.ime} logo`}
              className="mx-auto mb-4 h-24 w-24 rounded-full border-4 border-background bg-white object-cover shadow-md"
              data-testid="img-logo"
            />
          ) : (
            <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border-4 border-background text-3xl font-serif text-white shadow-md" style={{ backgroundColor: publicPrimary }}>
              {restaurant.ime.charAt(0)}
            </div>
          )}
          <h1 className="text-4xl font-medium tracking-tight text-foreground drop-shadow-sm @min-[768px]:text-5xl" style={{ fontFamily: "'Fraunces', serif" }} data-testid="text-venue-name">
            {restaurant.ime}
          </h1>
        </div>
      </div>

      <div className="relative z-20 -mt-8 mx-auto max-w-4xl px-4 py-12 @min-[640px]:px-6 @min-[1024px]:px-8">
        <div className="mb-8 rounded-xl border border-card-border bg-card p-6 shadow-sm @min-[768px]:p-8">
          {restaurant.opis ? (
            <p className="mx-auto mb-8 max-w-2xl text-center font-medium leading-relaxed text-muted-foreground" data-testid="text-venue-description">
              {restaurant.opis}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-6 text-sm @min-[768px]:grid-cols-2" data-testid="public-contact-hours-grid">
            <div className="space-y-3">
              <h3 className="text-lg font-medium" style={{ fontFamily: "'Fraunces', serif" }}>Kontakt</h3>
              {kontakt.telefon ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  {preview ? <span>{kontakt.telefon}</span> : <a href={`tel:${kontakt.telefon}`} className="transition-colors hover:text-primary">{kontakt.telefon}</a>}
                </div>
              ) : null}
              {kontakt.email ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  {preview ? <span>{kontakt.email}</span> : <a href={`mailto:${kontakt.email}`} className="transition-colors hover:text-primary">{kontakt.email}</a>}
                </div>
              ) : null}
              {restaurant.naslov ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>{restaurant.naslov}</span>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-medium" style={{ fontFamily: "'Fraunces', serif" }}>Delovni čas</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                {[...openingHours].sort((a, b) => a.dan - b.dan).map(oh => (
                  <div key={oh.dan} className="contents">
                    <span className="font-medium">{days[oh.dan - 1]}</span>
                    <span>
                      {oh.odprto && oh.intervals.length > 0
                        ? oh.intervals.map(interval => `${interval.od.substring(0, 5)} - ${interval.do.substring(0, 5)}`).join(", ")
                        : "Zaprto"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="w-full">
          <div className="mb-8 grid w-full grid-cols-2 rounded-lg border border-border bg-card p-1 shadow-sm" role="tablist" aria-label="Vsebina javne strani">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "rezervacija"}
              onClick={() => setActiveTab("rezervacija")}
              className="rounded-md py-2.5 text-lg transition-colors"
              style={activeTab === "rezervacija"
                ? { backgroundColor: publicPrimary, color: "white", fontFamily: "'Fraunces', serif" }
                : { fontFamily: "'Fraunces', serif" }}
              data-testid="button-preview-reservation-tab"
            >
              Rezervacija mize
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "boni"}
              onClick={() => setActiveTab("boni")}
              className="rounded-md py-2.5 text-lg transition-colors"
              style={activeTab === "boni"
                ? { backgroundColor: publicPrimary, color: "white", fontFamily: "'Fraunces', serif" }
                : { fontFamily: "'Fraunces', serif" }}
              data-testid="button-preview-vouchers-tab"
            >
              Darilni boni
            </button>
          </div>

          {activeTab === "rezervacija" ? (
            preview ? (
              <div className="rounded-xl border border-card-border bg-card p-6 text-center shadow-sm @min-[768px]:p-10">
                <CalendarDays className="mx-auto mb-4 h-9 w-9" style={{ color: publicPrimary }} />
                <h2 className="mb-2 text-2xl" style={{ fontFamily: "'Fraunces', serif" }}>Rezervacija mize</h2>
                <p className="mx-auto max-w-lg text-sm text-muted-foreground">
                  Gost bo tukaj izbral datum, uro in število oseb do največ {restaurant.maxPartySize}.
                </p>
              </div>
            ) : reservationContent
          ) : preview ? (
            <div className="space-y-4">
              {visibleProducts.length ? visibleProducts.map((product, index) => (
                <article key={product.id ?? index} className="overflow-hidden rounded-xl border border-card-border bg-card shadow-sm" data-testid={`card-preview-voucher-${index}`}>
                  {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-44 w-full object-cover" /> : null}
                  <div className="p-5">
                    <h2 className="text-xl" style={{ fontFamily: "'Fraunces', serif" }}>{product.naziv}</h2>
                    {product.opis ? <p className="mt-2 text-sm text-muted-foreground">{product.opis}</p> : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {product.variants.filter(variant => variant.active).map((variant, variantIndex) => (
                        <span key={variant.id ?? variantIndex} className="rounded-full border px-3 py-1 text-sm font-medium">
                          {variant.naziv} · {(variant.amountCents / 100).toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              )) : (
                <div className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">
                  <Gift className="mx-auto mb-3 h-8 w-8 opacity-50" />
                  <p>Aktivni darilni boni bodo prikazani tukaj.</p>
                </div>
              )}
            </div>
          ) : voucherContent}
        </div>
      </div>
    </div>
  );
}