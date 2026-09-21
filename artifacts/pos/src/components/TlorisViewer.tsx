import React, { useRef } from 'react';
import { Miza, Narocilo, Tloris, useGetProstorTloris } from "@workspace/api-client-react";
import { ShieldAlert } from "lucide-react";
import { resolveTableVisualStatus, TABLE_FLOOR_CLASS } from "@/lib/table-visual-status";

interface TlorisViewerProps {
  prostorId: number;
  vseMize: Miza[];
  filtriraneMize: Miza[];
  narocila: Narocilo[];
  onSelectMiza: (mizaId: number) => void;
  isPending: boolean;
}

export function TlorisViewer({
  prostorId,
  vseMize,
  filtriraneMize,
  narocila,
  onSelectMiza,
  isPending,
}: TlorisViewerProps) {
  const { data: tloris } = useGetProstorTloris(prostorId);
  const containerRef = useRef<HTMLDivElement>(null);

  let w = tloris?.width || 700;
  let h = tloris?.height || 440;
  const filteredIds = new Set(filtriraneMize.map(m => m.id));

  // Determine items to render
  const itemsToRender = [...(tloris?.items || [])];
  const renderedTableIds = new Set(itemsToRender.filter(i => i.kind === 'table' && i.tableId).map(i => i.tableId));

  // Add fallback items for tables missing from the canonical floor plan
  vseMize.forEach((m, idx) => {
    if (!renderedTableIds.has(m.id)) {
      const fbW = m.oblika === 'pravokotnik_h' ? 125 : m.oblika === 'pravokotnik_v' ? 75 : 100;
      const fbH = m.oblika === 'pravokotnik_h' ? 75 : m.oblika === 'pravokotnik_v' ? 125 : 100;
      const col = idx % 6;
      const row = Math.floor(idx / 6);
      
      const x = m.posX ?? (col * 135 + 10);
      const y = m.posY ?? (row * 135 + 10);
      
      if (x + fbW > w) w = x + fbW + 20;
      if (y + fbH > h) h = y + fbH + 20;

      itemsToRender.push({
        id: `fallback-${m.id}`,
        kind: 'table',
        tableId: m.id,
        x,
        y,
        width: fbW,
        height: fbH,
        rotation: 0,
        zIndex: 10,
        locked: true,
        visible: true,
        style: {},
        data: { oblika: m.oblika || 'pravokotnik_h' }
      } as any);
    }
  });

  // Sort by zIndex
  const sortedItems = itemsToRender.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  return (
    <div
      ref={containerRef}
      className="relative border-2 border-dashed border-border rounded-xl bg-stone-50 overflow-hidden w-full select-none"
      style={{ aspectRatio: `${w}/${h}` }}
    >
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
        <defs>
          <pattern id={`hp-tloris-dots-${prostorId}`} x="0" y="0" width={tloris?.gridSize || 25} height={tloris?.gridSize || 25} patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" className="text-gray-300" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#hp-tloris-dots-${prostorId})`} />
      </svg>

      <div className="absolute inset-0 w-full h-full" style={{ transformOrigin: 'top left', transform: 'scale(1)' }}>
        {sortedItems.map(item => {
          if (!item.visible) return null;

          const isTable = item.kind === 'table';
          const miza = isTable && item.tableId ? vseMize.find(m => m.id === item.tableId) : null;
          
          if (isTable && miza) {
            const isFiltered = filteredIds.has(miza.id);
            const aktivnaNarocila = narocila.filter(n => n.mizaId === miza.id && n.status === "odprto");
            const aktivnoNarocilo = aktivnaNarocila[0];
            const skupaj = aktivnaNarocila.reduce((vsota, narocilo) => vsota + narocilo.skupaj, 0);

            const visualStatus = resolveTableVisualStatus(miza.status, aktivnaNarocila);
            const borderColor = TABLE_FLOOR_CLASS[visualStatus];

            const opacityClass = isFiltered ? "opacity-100 shadow-md" : "opacity-40 grayscale";
            const oblika = item.data?.oblika as string || 'pravokotnik_h';
            
            const isBlocked = (aktivnoNarocilo as any)?.blokadaNatakarId != null;

            return (
              <button
                key={item.id}
                type="button"
                className={`absolute border-[3px] shadow transition-all duration-200 ${borderColor} ${opacityClass} ${isFiltered ? 'cursor-pointer hover:ring-4 hover:ring-primary/20 hover:scale-[1.02]' : 'cursor-default'}`}
                style={{
                  left: `${(item.x / w) * 100}%`,
                  top: `${(item.y / h) * 100}%`,
                  width: `${(item.width / w) * 100}%`,
                  height: `${(item.height / h) * 100}%`,
                  transform: `rotate(${item.rotation || 0}deg)`,
                  borderRadius: oblika === 'okrogla' ? '50%' : '6px',
                  zIndex: item.zIndex,
                }}
                onClick={() => {
                  if (!isFiltered) return;
                  onSelectMiza(miza.id);
                }}
                disabled={isPending}
                title={miza.ime || `Miza ${miza.stevilka}`}
              >
                {isBlocked && (
                  <ShieldAlert className="absolute top-0.5 right-0.5 w-3 h-3 text-red-500" style={{ transform: `rotate(-${item.rotation || 0}deg)` }} />
                )}
                <div style={{ transform: `rotate(-${item.rotation || 0}deg)` }} className="flex flex-col items-center justify-center w-full">
                  <span className="text-[clamp(7px,1.2vw,12px)] font-bold leading-tight px-0.5 truncate w-full text-center">
                    {miza.ime || `M${miza.stevilka}`}
                  </span>
                  {aktivnaNarocila.length > 0 && (
                    <span className="text-[clamp(6px,0.9vw,10px)] font-medium leading-tight">
                      {skupaj.toFixed(0)}€
                      {aktivnaNarocila.length > 1 ? ` · ${aktivnaNarocila.length} n.` : ""}
                    </span>
                  )}
                </div>
              </button>
            );
          }

          // Render other kinds
          const s = item.style || {};
          const d = item.data || {};

          let content = null;
          let className = "absolute flex items-center justify-center";
          
          if (item.kind === 'wall') {
            className += " border-stone-900";
          } else if (item.kind === 'door') {
            className += " bg-amber-700/80 border-amber-900 border";
          } else if (item.kind === 'opening') {
            className += " bg-transparent border-2 border-dashed border-stone-400";
          } else if (item.kind === 'zone') {
            className += " border-2 border-dashed opacity-50 pointer-events-none";
            content = <span className="font-bold text-lg pointer-events-none" style={{ color: s.color as string || '#000' }}>{d.name as string}</span>;
          } else if (item.kind === 'label') {
            className += " bg-transparent pointer-events-none";
            content = <span className="font-semibold whitespace-nowrap" style={{ fontSize: `${d.fontSize || 14}px`, color: s.color as string || '#000' }}>{d.text as string}</span>;
          } else if (item.kind === 'decoration') {
            if (d.type === 'plant') {
              className += " bg-emerald-600 rounded-full border-2 border-emerald-800 opacity-80";
            } else if (d.type === 'register') {
              className += " bg-stone-300 border-2 border-stone-500 rounded";
              content = <span className="text-xs font-bold text-stone-700">POS</span>;
            } else {
              className += " bg-stone-200 border-2 border-stone-400";
            }
          }

          return (
            <div
              key={item.id}
              className={className}
              style={{
                left: `${(item.x / w) * 100}%`,
                top: `${(item.y / h) * 100}%`,
                width: `${(item.width / w) * 100}%`,
                height: `${(item.height / h) * 100}%`,
                transform: `rotate(${item.rotation || 0}deg)`,
                backgroundColor: item.kind === 'zone' || item.kind === 'wall' ? (s.backgroundColor as string || (item.kind === 'wall' ? '#1c1917' : '#ccc')) : undefined,
                borderColor: item.kind === 'zone' ? (s.borderColor as string || '#999') : undefined,
                zIndex: item.zIndex,
              }}
            >
              {content && <div style={{ transform: `rotate(-${item.rotation || 0}deg)` }}>{content}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
