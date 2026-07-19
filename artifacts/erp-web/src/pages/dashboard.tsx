import React, { useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  Building2,
  BookOpen,
  FileText,
  Users,
  Truck,
  Receipt,
  BarChart3,
  ArrowUpRight,
  Plus,
  AlertTriangle,
  Clock,
  TrendingDown,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCompany } from "@/contexts/CompanyContext";
import { useGetOpenItems, useGetAgedAnalysis } from "@workspace/api-client-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtEur(value: number | string) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(n);
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string | null;
  sub: string;
  href: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  loading: boolean;
  alert?: boolean;
}

function KpiCard({ title, value, sub, href, icon: Icon, iconColor, iconBg, loading, alert }: KpiCardProps) {
  return (
    <Link href={href}>
      <Card className="h-full shadow-sm hover:shadow-md transition-shadow cursor-pointer border-border/60 hover:border-primary/30 group">
        <CardHeader className="pb-2 flex flex-row items-center gap-3">
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${iconBg} ${iconColor}`}>
            <Icon className="h-4 w-4" />
          </div>
          <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors leading-snug">
            {title}
          </CardTitle>
          {alert && (
            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0.5">!</Badge>
          )}
        </CardHeader>
        <CardContent className="pb-3">
          {loading ? (
            <Skeleton className="h-8 w-36" />
          ) : (
            <div className="text-2xl font-bold tracking-tight">{value ?? "—"}</div>
          )}
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </CardContent>
        <CardFooter className="pt-0 flex justify-end">
          <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
        </CardFooter>
      </Card>
    </Link>
  );
}

// ─── Aging chart ──────────────────────────────────────────────────────────────

const BUCKET_LABELS = ["Tekoče", "1-30 dni", "31-60 dni", "61-90 dni", "90+ dni"];
const BUCKET_KEYS: Array<"current" | "bucket1to30" | "bucket31to60" | "bucket61to90" | "bucketOver90"> = [
  "current",
  "bucket1to30",
  "bucket31to60",
  "bucket61to90",
  "bucketOver90",
];

const TERJATVE_COLORS = ["#3b82f6", "#f59e0b", "#f97316", "#ef4444", "#991b1b"];
const OBVEZ_COLORS = ["#8b5cf6", "#f59e0b", "#f97316", "#ef4444", "#991b1b"];

interface AgingChartProps {
  title: string;
  data: {
    current: number;
    bucket1to30: number;
    bucket31to60: number;
    bucket61to90: number;
    bucketOver90: number;
  } | null;
  colors: string[];
  loading: boolean;
}

function AgingChart({ title, data, colors, loading }: AgingChartProps) {
  const chartData = useMemo(() => {
    if (!data) return [];
    return BUCKET_KEYS.map((key, i) => ({
      name: BUCKET_LABELS[i],
      znesek: data[key],
      fill: colors[i],
    }));
  }, [data, colors]);

  return (
    <Card className="shadow-sm border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription className="text-xs">Starostna analiza odprtih postavk</CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-[180px] w-full" />
          </div>
        ) : !data || chartData.every((d) => d.znesek === 0) ? (
          <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">
            Ni odprtih postavk
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) =>
                  new Intl.NumberFormat("sl-SI", { maximumFractionDigits: 0 }).format(v)
                }
                width={60}
              />
              <Tooltip
                formatter={(value: number) => [fmtEur(value), "Znesek"]}
                labelStyle={{ fontSize: 12 }}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="znesek" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Module grid ──────────────────────────────────────────────────────────────

const MODULES = [
  {
    id: "kontni-plan",
    name: "Kontni plan",
    path: "/kontni-plan",
    icon: BookOpen,
    description: "Upravljanje sintetičnih in analitičnih kontov po SRS",
    color: "text-blue-600",
    bg: "bg-blue-600/10",
  },
  {
    id: "temeljnice",
    name: "Temeljnice",
    path: "/temeljnice",
    icon: FileText,
    description: "Vnosi v glavno knjigo in pregled dnevnikov",
    color: "text-emerald-600",
    bg: "bg-emerald-600/10",
  },
  {
    id: "kupci",
    name: "Kupci",
    path: "/kupci",
    icon: Users,
    description: "Izdani računi, saldakonti in terjatve",
    color: "text-indigo-600",
    bg: "bg-indigo-600/10",
  },
  {
    id: "dobavitelji",
    name: "Dobavitelji",
    path: "/dobavitelji",
    icon: Truck,
    description: "Prejeti računi, saldakonti in obveznosti",
    color: "text-amber-600",
    bg: "bg-amber-600/10",
  },
  {
    id: "ddv",
    name: "DDV evidence",
    path: "/ddv",
    icon: Receipt,
    description: "Knjige izdanih in prejetih računov, DDV-O obrazci",
    color: "text-rose-600",
    bg: "bg-rose-600/10",
  },
  {
    id: "porocila",
    name: "Poročila",
    path: "/porocila",
    icon: BarChart3,
    description: "Bilanca stanja, izkaz poslovnega izida, bruto bilanca",
    color: "text-purple-600",
    bg: "bg-purple-600/10",
  },
];

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { activeCompany } = useCompany();
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // Open items — terjatve (issued)
  const { data: terData, isLoading: terLoading } = useGetOpenItems(
    activeCompany?.id ?? "",
    { type: "issued" },
    { query: { enabled: !!activeCompany?.id } as any },
  );

  // Open items — obveznosti (received)
  const { data: obvData, isLoading: obvLoading } = useGetOpenItems(
    activeCompany?.id ?? "",
    { type: "received" },
    { query: { enabled: !!activeCompany?.id } as any },
  );

  // Aged analysis — terjatve
  const { data: agedTerData, isLoading: agedTerLoading } = useGetAgedAnalysis(
    activeCompany?.id ?? "",
    { type: "issued" },
    { query: { enabled: !!activeCompany?.id } as any },
  );

  // Aged analysis — obveznosti
  const { data: agedObvData, isLoading: agedObvLoading } = useGetAgedAnalysis(
    activeCompany?.id ?? "",
    { type: "received" },
    { query: { enabled: !!activeCompany?.id } as any },
  );

  // Derived KPIs
  const terjatveTotal = terData?.totalRemaining ?? null;
  const obveznostiTotal = obvData?.totalRemaining ?? null;

  const zapadleTerjatve = useMemo(() => {
    if (!terData?.items) return null;
    const sum = terData.items
      .filter((i) => i.daysOverdue > 0)
      .reduce((s, i) => s + parseFloat(i.remainingAmount), 0);
    return sum.toFixed(2);
  }, [terData]);

  const rokiV7 = useMemo(() => {
    if (!terData?.items) return null;
    const sum = terData.items
      .filter((i) => i.daysOverdue <= 0 && i.dueDate && i.dueDate <= in7)
      .reduce((s, i) => s + parseFloat(i.remainingAmount), 0);
    return sum.toFixed(2);
  }, [terData, in7]);

  const rokiV30 = useMemo(() => {
    if (!terData?.items) return null;
    const sum = terData.items
      .filter((i) => i.daysOverdue <= 0 && i.dueDate && i.dueDate <= in30)
      .reduce((s, i) => s + parseFloat(i.remainingAmount), 0);
    return sum.toFixed(2);
  }, [terData, in30]);

  // Totals buckets for charts
  const agedTerTotals = useMemo(() => {
    const t = agedTerData?.totals;
    if (!t) return null;
    return {
      current: parseFloat(t.current),
      bucket1to30: parseFloat(t.bucket1to30),
      bucket31to60: parseFloat(t.bucket31to60),
      bucket61to90: parseFloat(t.bucket61to90),
      bucketOver90: parseFloat(t.bucketOver90),
    };
  }, [agedTerData]);

  const agedObvTotals = useMemo(() => {
    const t = agedObvData?.totals;
    if (!t) return null;
    return {
      current: parseFloat(t.current),
      bucket1to30: parseFloat(t.bucket1to30),
      bucket31to60: parseFloat(t.bucket31to60),
      bucket61to90: parseFloat(t.bucket61to90),
      bucketOver90: parseFloat(t.bucketOver90),
    };
  }, [agedObvData]);

  const hasZapadle = zapadleTerjatve !== null && parseFloat(zapadleTerjatve) > 0;
  const kpiLoading = terLoading || obvLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nadzorna plošča</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeCompany ? activeCompany.name : "Izberite podjetje za prikaz podatkov"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" asChild>
            <Link href="/temeljnice/nova">
              <Plus className="h-4 w-4 mr-2" /> Nova temeljnica
            </Link>
          </Button>
        </div>
      </div>

      {!activeCompany ? (
        <Alert>
          <Building2 className="h-4 w-4" />
          <AlertDescription>
            Izberite podjetje v zgornjem desnem kotu za prikaz KPI podatkov.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* KPI cards */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Ključni kazalniki
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                title="Skupaj odprte terjatve"
                value={terjatveTotal !== null ? fmtEur(terjatveTotal) : null}
                sub="Izdani računi brez plačila"
                href="/saldakonti"
                icon={TrendingUp}
                iconColor="text-blue-600"
                iconBg="bg-blue-600/10"
                loading={terLoading}
              />
              <KpiCard
                title="Skupaj odprte obveznosti"
                value={obveznostiTotal !== null ? fmtEur(obveznostiTotal) : null}
                sub="Prejeti računi brez plačila"
                href="/saldakonti"
                icon={TrendingDown}
                iconColor="text-amber-600"
                iconBg="bg-amber-600/10"
                loading={obvLoading}
              />
              <KpiCard
                title="Zapadle terjatve"
                value={zapadleTerjatve !== null ? fmtEur(zapadleTerjatve) : null}
                sub="Terjatve po roku plačila"
                href="/saldakonti"
                icon={AlertTriangle}
                iconColor={hasZapadle ? "text-red-600" : "text-muted-foreground"}
                iconBg={hasZapadle ? "bg-red-600/10" : "bg-muted"}
                loading={terLoading}
                alert={hasZapadle}
              />
              <KpiCard
                title={`Roki v 7 / 30 dneh`}
                value={
                  rokiV7 !== null && rokiV30 !== null
                    ? `${fmtEur(rokiV7)} / ${fmtEur(rokiV30)}`
                    : null
                }
                sub="Terjatve ki zapadejo kmalu"
                href="/saldakonti"
                icon={Clock}
                iconColor="text-indigo-600"
                iconBg="bg-indigo-600/10"
                loading={terLoading}
              />
            </div>
          </div>

          {/* Aging charts */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Starostna analiza
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AgingChart
                title="Terjatve po starosti"
                data={agedTerTotals}
                colors={TERJATVE_COLORS}
                loading={agedTerLoading}
              />
              <AgingChart
                title="Obveznosti po starosti"
                data={agedObvTotals}
                colors={OBVEZ_COLORS}
                loading={agedObvLoading}
              />
            </div>
          </div>
        </>
      )}

      {/* Module grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Moduli sistema
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map((module) => (
            <Link key={module.id} href={module.path}>
              <Card className="h-full shadow-sm hover:shadow-md transition-shadow cursor-pointer border-border/60 hover:border-primary/30 group">
                <CardHeader className="pb-3 flex flex-row items-center gap-4">
                  <div
                    className={`h-10 w-10 rounded-lg flex items-center justify-center ${module.bg} ${module.color}`}
                  >
                    <module.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base group-hover:text-primary transition-colors">
                      {module.name}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pb-4">
                  <p className="text-sm text-muted-foreground line-clamp-2">{module.description}</p>
                </CardContent>
                <CardFooter className="pt-0 flex justify-end">
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
