import React, { useState } from "react";
import { useLocation } from "wouter";
import { Building2, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";

interface SetupForm {
  naziv: string;
  podjetjeDavcna: string;
  kratekNaziv: string;
  naslov: string;
  postnaStevika: string;
  kraj: string;
}

async function doSetup(form: SetupForm) {
  const res = await fetch("/api/admin/system/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export default function AdminSetupPage() {
  const [, setLocation] = useLocation();
  const { setActiveCompany } = useCompany();

  const [form, setForm] = useState<SetupForm>({
    naziv: "",
    podjetjeDavcna: "",
    kratekNaziv: "",
    naslov: "",
    postnaStevika: "",
    kraj: "",
  });
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof SetupForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    try {
      const company = await doSetup(form);
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
            Vpišite podatke podjetja, ki je lastnik tega programskega paketa ERP.
            Ta korak se opravi samo enkrat.
          </p>

          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
                <div className="flex">
                  <span className="inline-flex items-center px-3 text-sm border border-r-0 border-neutral-200 rounded-l-md bg-neutral-50 text-neutral-500">
                    SI
                  </span>
                  <input
                    required
                    type="text"
                    value={form.podjetjeDavcna}
                    onChange={set("podjetjeDavcna")}
                    placeholder="12345678"
                    pattern="\d{8}"
                    title="8 številk brez predpone SI"
                    className="flex-1 px-3 py-2 text-sm border border-neutral-200 rounded-r-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
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
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Naslov
                </label>
                <input
                  type="text"
                  value={form.naslov}
                  onChange={set("naslov")}
                  placeholder="Slovenska cesta 1"
                  className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Poštna številka
                </label>
                <input
                  type="text"
                  value={form.postnaStevika}
                  onChange={set("postnaStevika")}
                  placeholder="1000"
                  className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Kraj
                </label>
                <input
                  type="text"
                  value={form.kraj}
                  onChange={set("kraj")}
                  placeholder="Ljubljana"
                  className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isPending}
                className="w-full py-2.5 px-4 rounded-md bg-violet-700 hover:bg-violet-800 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Building2 className="h-4 w-4" />
                )}
                Nastavi lastnika ERP paketa
              </button>
            </div>
          </form>

          <p className="text-xs text-center text-neutral-400 mt-6">
            Podatke boste lahko pozneje spremenili v nastavitvah podjetja.
          </p>
        </div>
      </div>
    </div>
  );
}
