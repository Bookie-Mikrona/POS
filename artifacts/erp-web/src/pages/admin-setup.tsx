import React, { useState } from "react";
import { useLocation } from "wouter";
import { Building2, Loader2, ShieldCheck, AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";

type DavcnaLookup = "idle" | "loading" | "found" | "error";

interface ExistingCompany {
  id: string;
  naziv: string;
  kratekNaziv: string | null;
  podjetjeDavcna: string;
}

interface SetupForm {
  naziv: string;
  podjetjeDavcna: string;
  kratekNaziv: string;
  naslov: string;
  postnaStevika: string;
  kraj: string;
}

async function doSetup(body: { companyId: string } | SetupForm) {
  const res = await fetch("/api/admin/system/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export default function AdminSetupPage() {
  const [, setLocation] = useLocation();
  const { setActiveCompany } = useCompany();
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [form, setForm] = useState<SetupForm>({
    naziv: "", podjetjeDavcna: "", kratekNaziv: "",
    naslov: "", postnaStevika: "", kraj: "",
  });
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [davcnaLookup, setDavcnaLookup] = useState<DavcnaLookup>("idle");

  const handleDavcnaChange = async (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 8);
    setForm((f) => ({ ...f, podjetjeDavcna: cleaned }));
    if (cleaned.length === 8) {
      setDavcnaLookup("loading");
      try {
        const res = await fetch(`/api/admin/podjetje/poisci?davcna=${cleaned}`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        setForm((f) => ({
          ...f,
          naziv: d.naziv || f.naziv,
          kratekNaziv: d.kratekNaziv || f.kratekNaziv,
          naslov: d.naslov || f.naslov,
          postnaStevika: d.postnaStevika || f.postnaStevika,
          kraj: d.kraj || f.kraj,
        }));
        setDavcnaLookup("found");
      } catch {
        setDavcnaLookup("error");
      }
    } else {
      setDavcnaLookup("idle");
    }
  };

  // Pridobi obstoječa podjetja v sistemu
  const { data } = useQuery({
    queryKey: ["admin", "companies"],
    queryFn: async () => {
      const res = await fetch("/api/admin/companies");
      if (!res.ok) return { companies: [] as ExistingCompany[] };
      return res.json() as Promise<{ companies: ExistingCompany[] }>;
    },
  });
  const existing = data?.companies ?? [];

  const set = (k: keyof SetupForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (body: { companyId: string } | SetupForm) => {
    setIsPending(true);
    setError(null);
    try {
      const company = await doSetup(body);
      setActiveCompany(company);
      setLocation("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Napaka pri nastavitvi.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-zinc-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-sm border border-neutral-200/50 overflow-hidden">
        <div className="p-8">
          {/* Header */}
          <div className="flex justify-center mb-6">
            <div className="h-14 w-14 rounded-xl bg-violet-100 flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-violet-700" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-center text-neutral-900 mb-1">
            Prva nastavitev sistema
          </h1>
          <p className="text-sm text-center text-neutral-500 mb-8">
            Določite podjetje, ki je lastnik tega programskega paketa ERP.
          </p>

          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Obstoječa podjetja */}
          {existing.length > 0 && mode === "pick" && (
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">
                Izberite obstoječe podjetje
              </p>
              <div className="space-y-2">
                {existing.map((c) => (
                  <button
                    key={c.id}
                    disabled={isPending}
                    onClick={() => submit({ companyId: c.id })}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-neutral-200 hover:border-violet-300 hover:bg-violet-50 transition-colors text-left group disabled:opacity-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{c.naziv}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">{c.podjetjeDavcna}</p>
                    </div>
                    {isPending
                      ? <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                      : <ChevronRight className="h-4 w-4 text-neutral-400 group-hover:text-violet-600 transition-colors" />
                    }
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-neutral-200" />
                <span className="text-xs text-neutral-400">ali ustvarite novo</span>
                <div className="flex-1 h-px bg-neutral-200" />
              </div>
            </div>
          )}

          {/* Obrazec za novo podjetje */}
          {(mode === "new" || existing.length === 0) && (
            <form
              onSubmit={(e) => { e.preventDefault(); submit(form); }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Ime podjetja <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    value={form.naziv}
                    onChange={set("naziv")}
                    placeholder="Acme računovodstvo d.o.o."
                    className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Davčna številka <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2 items-center">
                    <div className="flex flex-1">
                      <input
                        required
                        type="text"
                        value={form.podjetjeDavcna}
                        onChange={(e) => handleDavcnaChange(e.target.value)}
                        placeholder="12345678"
                        maxLength={8}
                        className="flex-1 px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                      />
                    </div>
                    {davcnaLookup === "loading" && <Loader2 className="h-4 w-4 animate-spin text-neutral-400 shrink-0" />}
                    {davcnaLookup === "found" && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
                    {davcnaLookup === "error" && <span className="text-xs text-amber-600 shrink-0">Ni najdeno</span>}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Kratek naziv
                  </label>
                  <input
                    type="text"
                    value={form.kratekNaziv}
                    onChange={set("kratekNaziv")}
                    placeholder="Acme"
                    className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-neutral-700 mb-1">Naslov</label>
                  <input
                    type="text"
                    value={form.naslov}
                    onChange={set("naslov")}
                    placeholder="Slovenska cesta 1"
                    className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">Poštna številka</label>
                  <input
                    type="text"
                    value={form.postnaStevika}
                    onChange={set("postnaStevika")}
                    placeholder="1000"
                    className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">Kraj</label>
                  <input
                    type="text"
                    value={form.kraj}
                    onChange={set("kraj")}
                    placeholder="Ljubljana"
                    className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                {existing.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMode("pick")}
                    className="flex-1 py-2.5 px-4 rounded-md border border-neutral-200 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    Nazaj
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 py-2.5 px-4 rounded-md bg-violet-700 hover:bg-violet-800 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Building2 className="h-4 w-4" />
                  }
                  Nastavi lastnika ERP paketa
                </button>
              </div>
            </form>
          )}

          {/* Gumb za novo podjetje (ko so obstoječa vidna) */}
          {existing.length > 0 && mode === "pick" && (
            <button
              onClick={() => setMode("new")}
              className="w-full mt-2 py-2.5 px-4 rounded-md border-2 border-dashed border-neutral-200 text-sm font-medium text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2"
            >
              <Building2 className="h-4 w-4" />
              Vpiši novo podjetje
            </button>
          )}

          <p className="text-xs text-center text-neutral-400 mt-6">
            Podatke boste lahko pozneje spremenili v nastavitvah podjetja.
          </p>
        </div>
      </div>
    </div>
  );
}
