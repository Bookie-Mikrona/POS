import { useState } from "react";
import { useListTestniZagoni } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, AlertCircle, FlaskConical } from "lucide-react";
import type { TestniZagonPogled } from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Dot,
} from "recharts";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("sl-SI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateKratko(iso: string) {
  return new Date(iso).toLocaleString("sl-SI", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type GrafTocka = {
  datum: string;
  datumIso: string;
  padloTestov: number;
  status: TestniZagonPogled["status"];
};

function TrendGraf({ zagoni }: { zagoni: TestniZagonPogled[] }) {
  const data: GrafTocka[] = [...zagoni]
    .sort((a, b) => new Date(a.zagnanOb).getTime() - new Date(b.zagnanOb).getTime())
    .map(z => ({
      datum: formatDateKratko(z.zagnanOb),
      datumIso: z.zagnanOb,
      padloTestov: z.padloTestov,
      status: z.status,
    }));

  const maxPadlo = Math.max(...data.map(d => d.padloTestov), 1);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Trend padlih testov skozi čas
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="datum"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              domain={[0, maxPadlo + 1]}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as GrafTocka;
                return (
                  <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                    <p className="font-medium mb-1">{formatDate(d.datumIso)}</p>
                    <p className="text-muted-foreground">
                      Padlih testov: <span className="font-semibold text-foreground">{d.padloTestov}</span>
                    </p>
                    <p className="text-muted-foreground">
                      Status:{" "}
                      <span className={
                        d.status === "uspesno"
                          ? "text-green-700 font-semibold"
                          : "text-red-700 font-semibold"
                      }>
                        {d.status === "uspesno" ? "Uspešno" : d.status === "neuspesno" ? "Neuspešno" : "Napaka"}
                      </span>
                    </p>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="padloTestov"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={(props) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: GrafTocka };
                const color =
                  payload.status === "uspesno"
                    ? "#16a34a"
                    : "#dc2626";
                return (
                  <Dot
                    key={`dot-${payload.datumIso}`}
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                );
              }}
              activeDot={{ r: 7 }}
            />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-green-600" />
            Uspešen zagon
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-red-600" />
            Neuspešen / napaka
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTrajanje(sekunde: number | null) {
  if (sekunde === null) return "—";
  if (sekunde < 60) return `${sekunde.toFixed(1)} s`;
  const m = Math.floor(sekunde / 60);
  const s = Math.round(sekunde % 60);
  return `${m}m ${s}s`;
}

function StatusBadge({ status }: { status: TestniZagonPogled["status"] }) {
  if (status === "uspesno") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 flex items-center gap-1 w-fit">
        <CheckCircle2 className="h-3 w-3" />
        Uspešno
      </Badge>
    );
  }
  if (status === "neuspesno") {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 flex items-center gap-1 w-fit">
        <XCircle className="h-3 w-3" />
        Neuspešno
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 border-amber-200 flex items-center gap-1 w-fit">
      <AlertCircle className="h-3 w-3" />
      Napaka
    </Badge>
  );
}

function ZagonVrstica({ zagon }: { zagon: TestniZagonPogled }) {
  const [razvit, setRazvit] = useState(false);
  const imapadleTeste = zagon.padloTestov > 0 && zagon.padliTesti;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        className={`w-full text-left px-4 py-3 flex items-center gap-4 transition-colors ${
          imapadleTeste
            ? "hover:bg-muted/50 cursor-pointer"
            : "cursor-default"
        }`}
        onClick={() => { if (imapadleTeste) setRazvit(v => !v); }}
        disabled={!imapadleTeste}
      >
        <span className="shrink-0 text-muted-foreground">
          {imapadleTeste
            ? (razvit ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)
            : <span className="inline-block w-4" />}
        </span>

        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-foreground">
            {formatDate(zagon.zagnanOb)}
          </span>
        </span>

        <span className="shrink-0 hidden sm:flex items-center gap-1 text-sm text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          {zagon.prestaloTestov}
          {zagon.padloTestov > 0 && (
            <>
              <XCircle className="h-3.5 w-3.5 text-red-600 ml-1" />
              {zagon.padloTestov}
            </>
          )}
          <span className="ml-1">/ {zagon.skupajTestov}</span>
        </span>

        <span className="shrink-0 text-sm text-muted-foreground hidden md:block w-16 text-right">
          {formatTrajanje(zagon.trajanjeSekund ?? null)}
        </span>

        <span className="shrink-0">
          <StatusBadge status={zagon.status} />
        </span>
      </button>

      {razvit && imapadleTeste && (
        <div className="px-4 py-3 bg-red-50 border-t border-red-100">
          <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">Padli testi</p>
          <pre className="text-xs text-red-800 whitespace-pre-wrap font-mono leading-relaxed">
            {zagon.padliTesti}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function TestniZagoniPage() {
  const { data: zagoni, isLoading, isError, refetch } = useListTestniZagoni({ limit: 50 });

  const skupajZagonov = zagoni?.length ?? 0;
  const uspesnih = zagoni?.filter(z => z.status === "uspesno").length ?? 0;
  const neuspesnih = zagoni?.filter(z => z.status !== "uspesno").length ?? 0;

  return (
    <div className="p-6 space-y-6 flex-1 overflow-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FlaskConical className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Zgodovina testnih zagonov</h1>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Osveži
        </button>
      </div>

      {/* KPI kartice */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Skupaj zagonov</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold">{isLoading ? "—" : skupajZagonov}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-green-700 uppercase tracking-wide">Uspešnih</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold text-green-700">{isLoading ? "—" : uspesnih}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-red-700 uppercase tracking-wide">Neuspešnih</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-3xl font-bold text-red-700">{isLoading ? "—" : neuspesnih}</p>
          </CardContent>
        </Card>
      </div>

      {/* Graf trenda */}
      {!isLoading && !isError && zagoni && zagoni.length > 1 && (
        <TrendGraf zagoni={zagoni} />
      )}

      {/* Seznam zagonov */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">
          Napaka pri nalaganju podatkov. Preverite, ali imate administratorske pravice.
        </div>
      )}

      {!isLoading && !isError && zagoni && zagoni.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Še ni shranjenih testnih zagonov.</p>
        </div>
      )}

      {!isLoading && zagoni && zagoni.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Prikazanih zadnjih {zagoni.length} {zagoni.length === 1 ? "zagon" : "zagonov"} — kliknite na vrstico s padlimi testi za podrobnosti.
          </p>
          {zagoni.map(z => (
            <ZagonVrstica key={z.id} zagon={z} />
          ))}
        </div>
      )}
    </div>
  );
}
