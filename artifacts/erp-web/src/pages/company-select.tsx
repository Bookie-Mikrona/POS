import React, { useState } from "react";
import { useLocation } from "wouter";
import { Building2, Plus, ArrowRight, Loader2, AlertCircle, Clock, ShieldCheck, LogOut } from "lucide-react";
import { useListCompanies, useCreateCompany, useGetMe, type CompanyWithRole } from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useUser, useClerk } from "@clerk/react";

export default function CompanySelectPage() {
  const [, setLocation] = useLocation();
  const { setActiveCompany } = useCompany();
  const { data, isLoading: companiesLoading, error } = useListCompanies();
  const createCompany = useCreateCompany();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const { data: me, isLoading: meLoading } = useGetMe({ query: { enabled: isLoaded && !!user?.id, queryKey: ["/api/me"] } });
  const isSuperAdmin = !!(me as any)?.isSuperAdmin;

  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    podjetjeDavcna: "",
    naziv: "",
    kratekNaziv: "",
    naslov: "",
    postnaStevika: "",
    kraj: ""
  });

  const companies = data?.companies ?? [];

  // Počakamo da sta OBA klica zaključena preden določimo stanje
  const isLoading = companiesLoading || (isLoaded && !!user?.id && meLoading);

  const roleLabel = (role: string) => ({
    owner: "Lastnik", accountant: "Računovodja", viewer: "Pregledovalec",
    pos_admin: "POS – Admin podjetja", pos_admin_enote: "POS – Admin enote", pos_uporabnik: "POS – Uporabnik",
  })[role] ?? role;

  const isPosOnly = (company: CompanyWithRole & { posOnly?: boolean }) => !!(company as any).posOnly;

  const handleSelect = (company: CompanyWithRole) => {
    setActiveCompany(company);
    setLocation("/dashboard");
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createCompany.mutate({
      data: formData
    }, {
      onSuccess: (createdCompany) => {
        setActiveCompany(createdCompany);
        setLocation("/dashboard");
      }
    });
  };

  const handleSignOut = () => signOut({ redirectUrl: "/" });

  // Določimo stanje strani — šele ko sta OBA zahtevka zaključena
  const noAccess = !isLoading && !error && companies.length === 0 && !isSuperAdmin;
  const hasCompanies = !isLoading && !error && companies.length > 0;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-neutral-200/50 overflow-hidden">
        <div className="p-6">
          <div className="flex justify-center mb-6">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${noAccess ? "bg-amber-100" : "bg-neutral-100"}`}>
              {noAccess
                ? <Clock className="h-6 w-6 text-amber-600" />
                : <Building2 className="h-6 w-6 text-neutral-900" />}
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-center text-neutral-900 mb-2">
            {noAccess ? "Čakate na dostop" : "Izberite podjetje"}
          </h1>
          <p className="text-sm text-center text-neutral-500 mb-8">
            {noAccess
              ? "Vaš račun je registriran. Administrator sistema vam bo dodelil dostop do podjetja."
              : hasCompanies
                ? "Izberite podjetje, s katerim želite delati."
                : "Za nadaljevanje izberite podjetje, s katerim želite delati."}
          </p>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 mb-6">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">Prišlo je do napake pri nalaganju podjetij. Prosimo, poskusite znova.</p>
            </div>
          ) : (
            <div className="space-y-3 mb-8">
              {companies.map(company => {
                const posOnly = isPosOnly(company);
                if (posOnly) {
                  // POS-only podjetje — gumb odpre POS app
                  return (
                    <a
                      key={company.id}
                      href="/pos/"
                      className="w-full text-left flex items-center justify-between p-4 rounded-lg border border-amber-200 bg-amber-50/40 hover:bg-amber-50 transition-colors group"
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <h3 className="font-medium text-neutral-900 truncate">{company.naziv}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-neutral-500">{company.podjetjeDavcna}</span>
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                            {roleLabel(company.role)}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="h-5 w-5 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </a>
                  );
                }
                return (
                  <button
                    key={company.id}
                    onClick={() => handleSelect(company)}
                    className="w-full text-left flex items-center justify-between p-4 rounded-lg border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <h3 className="font-medium text-neutral-900 truncate">{company.naziv}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-neutral-500">SI{company.podjetjeDavcna}</span>
                        <span className="text-[10px] bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full font-medium">
                          {roleLabel(company.role)}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                );
              })}
              
              {companies.length === 0 && !isCreating && isSuperAdmin && (
                <div className="text-center py-8 space-y-3">
                  <div className="flex justify-center">
                    <div className="h-12 w-12 rounded-full bg-violet-100 flex items-center justify-center">
                      <ShieldCheck className="h-6 w-6 text-violet-700" />
                    </div>
                  </div>
                  <p className="text-sm font-medium text-neutral-900">Super admin</p>
                  <p className="text-xs text-neutral-500">Odprite administracijo za upravljanje podjetij.</p>
                  <a
                    href="/admin"
                    onClick={(e) => { e.preventDefault(); setLocation("/admin"); }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Odpri administracijo
                  </a>
                </div>
              )}
            </div>
          )}

          {isSuperAdmin && (isCreating ? (
            <div className="bg-neutral-50 rounded-lg p-5 border border-neutral-200 mt-4">
              <h3 className="font-medium text-neutral-900 mb-4 flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Novo podjetje
              </h3>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">Ime podjetja *</label>
                  <input
                    required
                    type="text"
                    value={formData.naziv}
                    onChange={e => setFormData({ ...formData, naziv: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                    placeholder="Acme d.o.o."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">Davčna številka *</label>
                  <input
                    required
                    type="text"
                    value={formData.podjetjeDavcna}
                    onChange={e => setFormData({ ...formData, podjetjeDavcna: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                    placeholder="12345678"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">Kratek naziv</label>
                  <input
                    type="text"
                    value={formData.kratekNaziv}
                    onChange={e => setFormData({ ...formData, kratekNaziv: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                    placeholder="Acme"
                  />
                </div>
                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="flex-1 py-2 px-4 rounded-md border border-neutral-200 text-sm font-medium text-neutral-700 hover:bg-neutral-100 transition-colors"
                  >
                    Prekliči
                  </button>
                  <button
                    type="submit"
                    disabled={createCompany.isPending}
                    className="flex-1 py-2 px-4 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {createCompany.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Ustvari
                  </button>
                </div>
                {createCompany.isError && (
                  <p className="text-xs text-red-600 mt-2">
                    Prišlo je do napake pri ustvarjanju podjetja. Preverite podatke.
                  </p>
                )}
              </form>
            </div>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-md border-2 border-dashed border-neutral-200 text-sm font-medium text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Dodaj novo podjetje
            </button>
          ))}

          {/* Odjava — vedno vidna */}
          <div className="mt-6 pt-5 border-t border-neutral-100 flex items-center justify-between">
            <p className="text-xs text-neutral-400 truncate max-w-[60%]">{user?.primaryEmailAddress?.emailAddress}</p>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Odjava
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}