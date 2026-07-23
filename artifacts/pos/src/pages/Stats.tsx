import { useGetStatistike } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import {
  DollarSign, Receipt, UtensilsCrossed, TrendingUp, Clock, User,
  CheckCircle2, Banknote, CreditCard, Gift, Smartphone, Landmark, Users, Package,
} from "lucide-react";
import type { IzmenaStat } from "@workspace/api-client-react";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
}

function elapsed(zacetek: string): string {
  const ms = Date.now() - new Date(zacetek).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function duration(zacetek: string, konec: string): string {
  const ms = new Date(konec).getTime() - new Date(zacetek).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const SHIFT_COLORS = [
  "hsl(var(--primary))",
  "hsl(220 70% 55%)",
  "hsl(160 60% 45%)",
  "hsl(35 90% 55%)",
  "hsl(280 65% 60%)",
  "hsl(0 70% 55%)",
];

type NacinPlacila = {
  kljuc: string;
  ime: string;
  barva: string;
  ikona: React.ReactNode;
};

const NACINI: NacinPlacila[] = [
  { kljuc: "gotovina",      ime: "Gotovina",       barva: "hsl(142 71% 45%)",  ikona: <Banknote className="h-4 w-4 text-green-600" /> },
  { kljuc: "kartica",       ime: "Kartica",         barva: "hsl(217 91% 60%)",  ikona: <CreditCard className="h-4 w-4 text-blue-600" /> },
  { kljuc: "sumup",         ime: "SumUp kartica",   barva: "hsl(271 81% 60%)",  ikona: <Smartphone className="h-4 w-4 text-purple-600" /> },
  { kljuc: "bon",           ime: "Bon",             barva: "hsl(32 95% 55%)",   ikona: <Gift className="h-4 w-4 text-orange-500" /> },
  { kljuc: "bonPica",       ime: "Bon za pico",     barva: "hsl(0 72% 51%)",    ikona: <Gift className="h-4 w-4 text-red-500" /> },
  { kljuc: "negotovinsko",  ime: "Negotovinsko",    barva: "hsl(199 89% 48%)",  ikona: <Landmark className="h-4 w-4 text-sky-600" /> },
  { kljuc: "reprezentanca", ime: "Reprezentanca",   barva: "hsl(45 93% 47%)",   ikona: <Users className="h-4 w-4 text-yellow-500" /> },
  { kljuc: "lastna_poraba", ime: "Lastna poraba",   barva: "hsl(240 5% 65%)",   ikona: <Package className="h-4 w-4 text-slate-500" /> },
];

function fmt(n: number) {
  return n.toFixed(2) + " €";
}

export default function Stats() {
  const { data: stats, isLoading } = useGetStatistike();

  if (isLoading) return <div className="p-8"><Skeleton className="h-[500px]" /></div>;
  if (!stats) return <div className="p-8">Ni podatkov.</div>;

  const shiftData = stats.prometPoIzmenah.map((iz, i) => ({
    ...iz,
    color: SHIFT_COLORS[i % SHIFT_COLORS.length],
    label: iz.natakarIme.split(" ")[0],
  }));

  const placila = stats.prometPoNacinuPlacila as unknown as Record<string, number>;

  const NAVIDEZNI = new Set(["reprezentanca", "lastna_poraba"]);
  const skupajPlacila = NACINI
    .filter(n => !NAVIDEZNI.has(n.kljuc))
    .reduce((acc, n) => acc + (placila[n.kljuc] ?? 0), 0);

  const pieData = NACINI
    .filter(n => !NAVIDEZNI.has(n.kljuc))
    .map(n => ({ ...n, znesek: placila[n.kljuc] ?? 0 }))
    .filter(n => n.znesek > 0);

  const barData = NACINI
    .filter(n => !NAVIDEZNI.has(n.kljuc))
    .map(n => ({ ime: n.ime, znesek: placila[n.kljuc] ?? 0, barva: n.barva }))
    .filter(n => n.znesek > 0);

  const hasPayments = skupajPlacila > 0;

  return (
    <div className="p-8 space-y-6 flex-1 overflow-auto">
      <h1 className="text-3xl font-bold tracking-tight">Dnevna statistika</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dnevni promet</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.dnevniPromet.toFixed(2)} €</div>
            <p className="text-xs text-muted-foreground">Skupaj z DDV</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Izdani računi</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.steviloRacunov}</div>
            <p className="text-xs text-muted-foreground">Danes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Aktivna naročila</CardTitle>
            <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.steviloAktivnihNarocil}</div>
            <p className="text-xs text-muted-foreground">Trenutno odprta</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Obračunan DDV</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.skupajDDV.toFixed(2)} €</div>
            <p className="text-xs text-muted-foreground">Za današnje račune</p>
          </CardContent>
        </Card>
      </div>

      {/* Payment method breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-blue-500" />
            Razčlenitev po načinu plačila — danes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasPayments ? (
            <div className="text-center text-muted-foreground py-8">Danes še ni izdanih računov.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pie chart */}
              <div className="h-[280px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="znesek"
                      nameKey="ime"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      innerRadius={50}
                      paddingAngle={2}
                      label={({ ime, percent }) =>
                        percent > 0.04 ? `${(percent * 100).toFixed(0)}%` : ""
                      }
                      labelLine={false}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.barva} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [fmt(value), name]}
                    />
                    <Legend
                      formatter={(value) => <span className="text-sm">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div className="flex flex-col justify-center">
                <div className="space-y-1">
                  {NACINI.map(n => {
                    const znesek = placila[n.kljuc] ?? 0;
                    if (znesek === 0) return null;
                    const pct = skupajPlacila > 0 ? (znesek / skupajPlacila) * 100 : 0;
                    return (
                      <div key={n.kljuc} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors">
                        <span className="flex-shrink-0">{n.ikona}</span>
                        <span className="flex-1 text-sm font-medium">{n.ime}</span>
                        <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(0)}%</span>
                        <span className="font-bold text-sm w-24 text-right tabular-nums">{fmt(znesek)}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-3 rounded-lg px-3 py-2 border-t mt-2 pt-3">
                    <span className="flex-shrink-0 w-4" />
                    <span className="flex-1 text-sm font-semibold text-muted-foreground">Skupaj</span>
                    <span className="text-xs text-muted-foreground w-10 text-right">100%</span>
                    <span className="font-bold text-sm w-24 text-right tabular-nums">{fmt(skupajPlacila)}</span>
                  </div>

                  {/* Navidezni promet — reprezentanca & lastna poraba */}
                  {NACINI.filter(n => NAVIDEZNI.has(n.kljuc) && (placila[n.kljuc] ?? 0) > 0).length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-3 pt-3 pb-1 font-semibold">
                        Navidezni promet (ni vključen v skupaj)
                      </p>
                      {NACINI.filter(n => NAVIDEZNI.has(n.kljuc)).map(n => {
                        const znesek = placila[n.kljuc] ?? 0;
                        if (znesek === 0) return null;
                        return (
                          <div key={n.kljuc} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors opacity-70">
                            <span className="flex-shrink-0">{n.ikona}</span>
                            <span className="flex-1 text-sm font-medium">{n.ime}</span>
                            <span className="text-xs text-muted-foreground w-10 text-right">—</span>
                            <span className="font-bold text-sm w-24 text-right tabular-nums">{fmt(znesek)}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                {/* Bon za pico note */}
                {(placila["steviloBonov"] ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground mt-3 px-3">
                    Prejeti boni za pico: {placila["steviloBonov"]} × 10,00 € = {fmt(placila["bonPica"] ?? 0)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Bar chart comparing all methods */}
          {hasPayments && barData.length > 1 && (
            <div className="mt-6 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">Primerjava po metodah</p>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="ime" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v} €`} />
                    <Tooltip formatter={(value: number) => [fmt(value), "Znesek"]} />
                    <Bar dataKey="znesek" radius={[6, 6, 0, 0]}>
                      {barData.map((entry, i) => (
                        <Cell key={i} fill={entry.barva} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shift breakdown */}
      {shiftData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              Promet po izmenah — danes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bar chart */}
              {shiftData.length > 0 && (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={shiftData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [`${value.toFixed(2)} €`, "Promet"]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.natakarIme ?? ""}
                      />
                      <Bar dataKey="skupajZnesek" radius={[6, 6, 0, 0]}>
                        {shiftData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Per-shift detail cards */}
              <div className="space-y-3">
                {shiftData.map((iz) => (
                  <div
                    key={iz.izmenaId}
                    className="flex items-center gap-4 rounded-xl border px-4 py-3"
                    style={{ borderLeftColor: iz.color, borderLeftWidth: 4 }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="font-semibold truncate">{iz.natakarIme}</span>
                        {iz.aktivna ? (
                          <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">
                            <Clock className="h-2.5 w-2.5 mr-1" />
                            Aktivna
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                            Zaprta
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span>{formatTime(iz.zacetek)}</span>
                        <span>–</span>
                        <span>{iz.konec ? formatTime(iz.konec) : "..."}</span>
                        <span className="text-muted-foreground/60">
                          ({iz.aktivna ? elapsed(iz.zacetek) : duration(iz.zacetek, iz.konec!)})
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-bold text-primary">{iz.skupajZnesek.toFixed(2)} €</div>
                      <div className="text-xs text-muted-foreground">{iz.steviloRacunov} računov</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hourly + Top items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Promet po urah</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.prometPoUrah}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="ura" tickFormatter={(v) => `${v}:00`} />
                <YAxis />
                <Tooltip formatter={(value: number) => [`${value.toFixed(2)} €`, 'Promet']} labelFormatter={(v) => `Ura: ${v}:00`} />
                <Bar dataKey="znesek" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Priljubljeni artikli</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.priljubljeniArtikli.map((artikel, idx) => (
                <div key={artikel.artikelId} className="flex items-center">
                  <div className="w-8 text-center font-bold text-muted-foreground">{idx + 1}.</div>
                  <div className="flex-1 font-medium">{artikel.ime}</div>
                  <div className="text-right">
                    <div className="font-bold">{artikel.skupajZnesek.toFixed(2)} €</div>
                    <div className="text-xs text-muted-foreground">{artikel.steviloNarocil}x prodano</div>
                  </div>
                </div>
              ))}
              {stats.priljubljeniArtikli.length === 0 && (
                <div className="text-center text-muted-foreground py-8">Ni prodanih artiklov.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
