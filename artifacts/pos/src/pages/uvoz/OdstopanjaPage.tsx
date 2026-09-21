// artifacts/pos/src/pages/uvoz/OdstopanjaPage.tsx
//
// Stran za censka odstopanja — ovija OdstopanjaPogled z upravljanjem
// stanja in klicev API.

import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { OdstopanjaPogled, type Odstopanje } from './OdstopanjaPogled';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

function isoZaDan(offsetDni: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDni);
  return d.toISOString().slice(0, 10);
}

export default function OdstopanjaPage() {
  const [, navigate] = useLocation();
  const [od, setOd] = useState(() => isoZaDan(-30));
  const [do_, setDo] = useState(() => isoZaDan(0));
  const [prag, setPrag] = useState(10);
  const [nalaganje, setNalaganje] = useState(false);
  const [odstopanja, setOdstopanja] = useState<Odstopanje[]>([]);
  const [skupniUcinek, setSkupniUcinek] = useState('0');
  const [napaka, setNapaka] = useState<string | null>(null);

  const nalozi = useCallback(async (odD: string, doD: string, pragD: number) => {
    setNalaganje(true);
    setNapaka(null);
    try {
      const params = new URLSearchParams({ od: odD, do: doD, minOdstopanje: String(pragD) });
      const r = await fetch(`${base}/api/pos/uvoz/odstopanja?${params}`, { credentials: 'include' });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        setNapaka(`Napaka ${r.status}${txt ? `: ${txt}` : ''}`);
        return;
      }
      const d = await r.json();
      setOdstopanja(d.odstopanja ?? []);
      setSkupniUcinek(d.skupniUcinek ?? '0');
    } catch (e) {
      setNapaka(e instanceof Error ? e.message : 'Neznana napaka');
    } finally {
      setNalaganje(false);
    }
  }, []);

  useEffect(() => { nalozi(od, do_, prag); }, [od, do_, prag, nalozi]);

  const handleObdobje = useCallback((novOd: string, novDo: string) => {
    setOd(novOd);
    setDo(novDo);
  }, []);

  const handlePrag = useCallback((novPrag: number) => {
    setPrag(novPrag);
  }, []);

  const handleReklamacija = useCallback((_dobaviteljId: number, _prejemnicePostavke: number[]) => {
    // Placeholder: v prihodnje odpre reklamacijski obrazec
  }, []);

  const handleOdpriPrejemnico = useCallback((id: number) => {
    navigate(`/zaloge?prejemnica=${id}`);
  }, [navigate]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Censka odstopanja</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Primerjava nabavnih cen med zaporednimi prejemnicami istega artikla od istega dobavitelja.
        </p>
      </div>

      {napaka && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {napaka}
        </div>
      )}

      <OdstopanjaPogled
        odstopanja={odstopanja}
        skupniUcinek={skupniUcinek}
        obdobjeOd={od}
        obdobjeDo={do_}
        nalaganje={nalaganje}
        onObdobje={handleObdobje}
        onPragSpremenjen={handlePrag}
        onReklamacija={handleReklamacija}
        onOdpriPrejemnico={handleOdpriPrejemnico}
      />
    </div>
  );
}
