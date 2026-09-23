import { useState, useMemo, useEffect } from "react";
import { Search, Filter, Printer, Download, BookOpen, CheckCircle2, Circle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { manualChapters } from "./data/chapters";

export default function PrirocnikPage() {
  const [search, setSearch] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [readChapters, setReadChapters] = useState<Set<string>>(new Set());
  const pdfUrl = `${import.meta.env.BASE_URL}POS-Gostinstvo-prirocnik.pdf`;

  useEffect(() => {
    try {
      const stored = localStorage.getItem("pos_manual_progress");
      if (stored) setReadChapters(new Set(JSON.parse(stored)));
    } catch {}
  }, []);

  const toggleRead = (id: string) => {
    const next = new Set(readChapters);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setReadChapters(next);
    localStorage.setItem("pos_manual_progress", JSON.stringify(Array.from(next)));
  };

  const roles = useMemo(() => {
    const r = new Set<string>();
    manualChapters.forEach(c => c.roles.forEach(role => r.add(role)));
    return Array.from(r).sort();
  }, []);

  const toggleRole = (role: string) => {
    const next = new Set(selectedRoles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setSelectedRoles(next);
  };

  const filtered = useMemo(() => manualChapters.filter(c => {
    const query = search.toLowerCase();
    const matchSearch = search ? c.title.toLowerCase().includes(query) || c.description.toLowerCase().includes(query) : true;
    const matchRole = selectedRoles.size === 0 || c.roles.some(r => selectedRoles.has(r));
    return matchSearch && matchRole;
  }), [search, selectedRoles]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="shrink-0 border-b bg-card px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Priročnik in navodila
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Uradna dokumentacija za uporabo Bookie POS Gostinstvo.</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="outline" size="sm" asChild className="flex-1 sm:flex-auto">
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer"><Printer className="h-4 w-4 mr-2" />Natisni</a>
          </Button>
          <Button variant="default" size="sm" asChild className="flex-1 sm:flex-auto">
            <a href={pdfUrl} download><Download className="h-4 w-4 mr-2" />Prenesi PDF</a>
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-64 shrink-0 flex flex-col gap-6">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Iskanje po priročniku..." className="pl-9 bg-card" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground"><Filter className="h-4 w-4 text-primary" />Filtri po vlogi</h3>
            <div className="flex flex-wrap gap-2">
              {roles.map(r => <Badge key={r} variant={selectedRoles.has(r) ? "default" : "outline"} className="cursor-pointer transition-colors" onClick={() => toggleRole(r)}>{r}</Badge>)}
            </div>
            {selectedRoles.size > 0 && <button onClick={() => setSelectedRoles(new Set())} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">Počisti filtre</button>}
          </div>
          <div className="space-y-3 p-5 bg-card rounded-xl border shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">Tvoj napredek</h3>
            <div className="flex items-baseline gap-1"><span className="text-3xl font-black text-primary">{Math.round((readChapters.size / manualChapters.length) * 100)}</span><span className="text-lg font-bold text-muted-foreground">%</span></div>
            <p className="text-xs text-muted-foreground mt-1">Prebrano {readChapters.size} od {manualChapters.length} poglavij</p>
            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden mt-3"><div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${(readChapters.size / manualChapters.length) * 100}%` }} /></div>
          </div>
        </div>
        <div className="flex-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground"><BookOpen className="h-12 w-12 mb-4 opacity-20" /><p>Ni zadetkov za izbrane filtre.</p></div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 auto-rows-max">
              {filtered.map(chapter => {
                const isRead = readChapters.has(chapter.id);
                return <div key={chapter.id} className="group relative border rounded-xl p-5 bg-card hover:shadow-md hover:border-primary/40 transition-all flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4 gap-4">
                    <div className="flex items-start gap-3"><span className="text-3xl font-black text-muted-foreground/20 leading-none group-hover:text-primary/20 transition-colors mt-0.5">{chapter.id}</span><h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">{chapter.title}</h3></div>
                    <button onClick={() => toggleRead(chapter.id)} className={`shrink-0 transition-colors ${isRead ? "text-primary" : "text-muted-foreground hover:text-primary"}`} title={isRead ? "Označi kot neprebrano" : "Označi kot prebrano"}>{isRead ? <CheckCircle2 className="h-6 w-6" /> : <Circle className="h-6 w-6" />}</button>
                  </div>
                  <p className="text-sm text-muted-foreground flex-1 mb-6">{chapter.description}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-auto pt-4 border-t border-border/50">
                    {chapter.roles.map(r => <span key={r} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">{r}</span>)}
                    <a href="#celoten-prirocnik" className="ml-auto text-xs font-semibold text-primary hover:underline">Preberi poglavje v priročniku</a>
                  </div>
                </div>;
              })}
            </div>
          )}
          <section id="celoten-prirocnik" className="mt-8 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-col gap-2 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="font-semibold">Celoten priročnik</h2><p className="text-sm text-muted-foreground">Podrobna navodila, postopki, opozorila, kontrolni seznami in zaslonske slike.</p></div>
              <Button variant="outline" size="sm" asChild><a href={pdfUrl} target="_blank" rel="noopener noreferrer">Odpri v novem zavihku</a></Button>
            </div>
            <object data={pdfUrl} type="application/pdf" className="h-[75vh] min-h-[720px] w-full bg-muted/20" aria-label="Celoten priročnik POS Gostinstvo">
              <div className="p-8 text-center text-sm text-muted-foreground">Brskalnik ne more prikazati PDF-ja. <a className="font-semibold text-primary underline" href={pdfUrl}>Prenesite priročnik.</a></div>
            </object>
          </section>
        </div>
      </div>
    </div>
  );
}