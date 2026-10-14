import { formatMizaLabel } from "@/lib/mizaLabel";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Miza, Tloris, TlorisInput, TlorisPostavka,
  useGetProstorTloris, useUpdateProstorTloris, useResetProstorTloris, getGetProstorTlorisQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Move, Square, Circle, Type, PaintBucket,
  Save, RotateCcw, RotateCw, MousePointer2, GripHorizontal,
  Trash2, Copy, Lock, Unlock, Eye, EyeOff, LayoutGrid, Undo, Redo
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type TlorisPostavkaKind = 'table' | 'wall' | 'door' | 'opening' | 'label' | 'zone' | 'decoration';
export type TableShape = 'pravokotnik_h' | 'pravokotnik_v' | 'kvadrat' | 'okrogla';

const TABLE_SHAPE_DIMENSIONS: Record<TableShape, { width: number; height: number }> = {
  pravokotnik_h: { width: 125, height: 75 },
  pravokotnik_v: { width: 75, height: 125 },
  kvadrat: { width: 100, height: 100 },
  okrogla: { width: 100, height: 100 },
};

export function applyTableShape(
  item: TlorisPostavka,
  shape: TableShape,
  canvasWidth: number,
  canvasHeight: number,
): TlorisPostavka {
  const { width, height } = TABLE_SHAPE_DIMENSIONS[shape];
  const centerX = item.x + item.width / 2;
  const centerY = item.y + item.height / 2;
  const x = Math.round(Math.min(Math.max(0, centerX - width / 2), Math.max(0, canvasWidth - width)));
  const y = Math.round(Math.min(Math.max(0, centerY - height / 2), Math.max(0, canvasHeight - height)));
  return {
    ...item,
    x,
    y,
    width,
    height,
    data: { ...item.data, oblika: shape },
  };
}

interface DeferredNumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

function DeferredNumberInput({ value, onCommit, min, max, className }: DeferredNumberInputProps) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  const [focused, setFocused] = useState(false);
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    if (!focused) setDraft(String(Math.round(value)));
  }, [value, focused]);

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setDraft(String(Math.round(value)));
      return;
    }
    const next = Math.round(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed)));
    setDraft(String(next));
    if (next !== Math.round(value)) onCommit(next);
  };

  return (
    <Input
      type="number"
      className={className}
      value={draft}
      onFocus={() => {
        cancelCommitRef.current = false;
        setFocused(true);
      }}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        setFocused(false);
        if (cancelCommitRef.current) {
          cancelCommitRef.current = false;
          setDraft(String(Math.round(value)));
          return;
        }
        commit();
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelCommitRef.current = true;
          setDraft(String(Math.round(value)));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface TlorisEditorProps {
  prostorId: number;
  mize: Miza[];
}

const DEFAULT_W = 700;
const DEFAULT_H = 440;
const DEFAULT_GRID = 25;

function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

function itM(items: TlorisPostavka[], id: string, updates: Partial<TlorisPostavka>) {
  return items.map(i => i.id === id ? { ...i, ...updates } as TlorisPostavka : i);
}

export function TlorisEditor({
  prostorId, mize
}: TlorisEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: tloris, isFetching } = useGetProstorTloris(prostorId);
  const updateTloris = useUpdateProstorTloris();
  const resetTloris = useResetProstorTloris();

  const [doc, setDoc] = useState<Tloris | null>(null);

  // History for Undo/Redo
  const [history, setHistory] = useState<Tloris[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [lastSavedIdx, setLastSavedIdx] = useState(0);

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const pushHistory = useCallback((newDoc: Tloris) => {
    setHistoryIdx(prevIdx => {
      setHistory(prevHist => {
        const newHist = prevHist.slice(0, prevIdx + 1);
        newHist.push(newDoc);
        return newHist;
      });
      return prevIdx + 1;
    });
  }, []);

  const undo = () => {
    setHistoryIdx(prev => {
      if (prev > 0) {
        setDoc(history[prev - 1]);
        return prev - 1;
      }
      return prev;
    });
  };

  const redo = () => {
    setHistoryIdx(prev => {
      if (prev < history.length - 1) {
        setDoc(history[prev + 1]);
        return prev + 1;
      }
      return prev;
    });
  };

  const [snapToGrid, setSnapToGrid] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<string>('select');

  const canvasRef = useRef<HTMLDivElement>(null);

  // Initialize doc when tloris loads
  useEffect(() => {
    if (tloris && history.length === 0 && !isFetching) {
      const items = [...tloris.items];
      const tableItems = items.filter(i => i.kind === 'table');
      const tableIds = new Set(tableItems.map(i => i.tableId));

      let currentW = tloris.width || DEFAULT_W;
      let currentH = tloris.height || DEFAULT_H;

      mize.forEach((m, i) => {
        if (!tableIds.has(m.id)) {
          const w = m.oblika === 'pravokotnik_h' ? 125 : m.oblika === 'pravokotnik_v' ? 75 : 100;
          const h = m.oblika === 'pravokotnik_h' ? 75 : m.oblika === 'pravokotnik_v' ? 125 : 100;
          const col = i % 6;
          const row = Math.floor(i / 6);

          const x = m.posX ?? (col * 135 + 10);
          const y = m.posY ?? (row * 135 + 10);

          if (x + w > currentW) currentW = x + w + 20;
          if (y + h > currentH) currentH = y + h + 20;

          items.push({
            id: `t-${m.id}`,
            kind: 'table',
            tableId: m.id,
            x,
            y,
            width: w,
            height: h,
            rotation: 0,
            zIndex: 10,
            locked: false,
            visible: true,
            style: {},
            data: { oblika: m.oblika || 'pravokotnik_h' }
          });
        }
      });

      const newDoc = {
        version: tloris.version,
        width: currentW,
        height: currentH,
        gridSize: tloris.gridSize || DEFAULT_GRID,
        items
      };
      setDoc(newDoc);
      setHistory([newDoc]);
      setHistoryIdx(0);
      setLastSavedIdx(0);
    } else if (!tloris && !isFetching && history.length === 0) {
      let currentW = DEFAULT_W;
      let currentH = DEFAULT_H;

      const items: TlorisPostavka[] = mize.map((m, i) => {
        const w = m.oblika === 'pravokotnik_h' ? 125 : m.oblika === 'pravokotnik_v' ? 75 : 100;
        const h = m.oblika === 'pravokotnik_h' ? 75 : m.oblika === 'pravokotnik_v' ? 125 : 100;
        const col = i % 6;
        const row = Math.floor(i / 6);

        const x = m.posX ?? (col * 135 + 10);
        const y = m.posY ?? (row * 135 + 10);

        if (x + w > currentW) currentW = x + w + 20;
        if (y + h > currentH) currentH = y + h + 20;

        return {
          id: `t-${m.id}`,
          kind: 'table',
          tableId: m.id,
          x,
          y,
          width: w,
          height: h,
          rotation: 0,
          zIndex: 10,
          locked: false,
          visible: true,
          style: {},
          data: { oblika: m.oblika || 'pravokotnik_h' }
        };
      });
      const newDoc = { version: 0, width: currentW, height: currentH, gridSize: DEFAULT_GRID, items };
      setDoc(newDoc);
      setHistory([newDoc]);
      setHistoryIdx(0);
      setLastSavedIdx(0);
    }
  }, [tloris, mize, isFetching, history.length]);

  // Keep an already-open editor in sync when a table is added to this room.
  useEffect(() => {
    if (isFetching) return;
    setDoc(prev => {
      if (!prev) return prev;
      const tableIds = new Set(prev.items.filter(item => item.kind === 'table').map(item => item.tableId));
      const missing = mize.filter(miza => !tableIds.has(miza.id));
      if (missing.length === 0) return prev;

      let width = prev.width;
      let height = prev.height;
      const items = [...prev.items];
      for (const miza of missing) {
        const fallbackWidth = miza.oblika === 'pravokotnik_v' ? 75 : miza.oblika === 'pravokotnik_h' ? 125 : 100;
        const fallbackHeight = miza.oblika === 'pravokotnik_v' ? 125 : miza.oblika === 'pravokotnik_h' ? 75 : 100;
        const itemWidth = fallbackWidth;
        const itemHeight = fallbackHeight;
        const index = items.filter(item => item.kind === 'table').length;
        const x = miza.posX ?? ((index % 6) * 135 + 10);
        const y = miza.posY ?? (Math.floor(index / 6) * 135 + 10);
        width = Math.max(width, x + itemWidth + 20);
        height = Math.max(height, y + itemHeight + 20);
        items.push({
          id: `t-${miza.id}`,
          kind: 'table',
          tableId: miza.id,
          x,
          y,
          width: itemWidth,
          height: itemHeight,
          rotation: 0,
          zIndex: 10,
          locked: false,
          visible: true,
          style: {},
          data: { oblika: miza.oblika || 'pravokotnik_h' },
        });
      }

      const merged = { ...prev, width, height, items };
      pushHistory(merged);
      return merged;
    });
  }, [mize, isFetching, pushHistory]);

  const updateItems = useCallback((updater: (items: TlorisPostavka[]) => TlorisPostavka[]) => {
    setDoc(prev => {
      if (!prev) return prev;
      let newItems = updater([...prev.items]);

      // Clamp items to canvas bounds
      newItems = newItems.map(it => {
        let { x, y } = it;
        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (x + it.width > prev.width) x = Math.max(0, prev.width - it.width);
        if (y + it.height > prev.height) y = Math.max(0, prev.height - it.height);
        return { ...it, x, y };
      });

      const newDoc = { ...prev, items: newItems };
      pushHistory(newDoc);
      return newDoc;
    });
  }, [pushHistory]);

  const updateCanvas = useCallback((updates: Partial<Tloris>) => {
    setDoc(prev => {
      if (!prev) return prev;
      const newDoc = { ...prev, ...updates };
      // Clamp items if shrinking
      newDoc.items = newDoc.items.map(it => {
        let { x, y } = it;
        if (x + it.width > newDoc.width) x = Math.max(0, newDoc.width - it.width);
        if (y + it.height > newDoc.height) y = Math.max(0, newDoc.height - it.height);
        return { ...it, x, y };
      });
      pushHistory(newDoc);
      return newDoc;
    });
  }, [pushHistory]);

  const snap = useCallback((v: number, gridSize: number) => {
    return snapToGrid ? Math.round(v / gridSize) * gridSize : v;
  }, [snapToGrid]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (e.key === 'Escape') {
        setSelectedIds([]);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          const canDelete = selectedIds.some(id => {
            const item = doc?.items.find(i => i.id === id);
            return item && item.kind !== 'table';
          });
          if (canDelete) {
            setDeleteConfirmOpen(true);
          }
        }
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : (snapToGrid && doc ? doc.gridSize : 1);
          let dx = 0, dy = 0;
          if (e.key === 'ArrowUp') dy = -step;
          if (e.key === 'ArrowDown') dy = step;
          if (e.key === 'ArrowLeft') dx = -step;
          if (e.key === 'ArrowRight') dx = step;

          updateItems(items => items.map(it => {
            if (selectedIds.includes(it.id) && !it.locked) {
              return {
                 ...it,
                 x: Math.max(0, Math.min((doc?.width || 0) - it.width, it.x + dx)),
                 y: Math.max(0, Math.min((doc?.height || 0) - it.height, it.y + dy))
              };
            }
            return it;
          }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, doc, snapToGrid, updateItems]);


  const resizeRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    rotation: number;
    target: Element;
  } | null>(null);

  const handleResizePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();

    containerRef.current?.focus({ preventScroll: true });

    const item = doc?.items.find(i => i.id === id);
    if (!item || item.locked || !doc) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = doc.width / rect.width;
    const scaleY = doc.height / rect.height;

    resizeRef.current = {
      id,
      startX: e.clientX * scaleX,
      startY: e.clientY * scaleY,
      origW: item.width,
      origH: item.height,
      rotation: item.rotation || 0,
      target: e.currentTarget as Element
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const handleRotateClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    updateItems(items => items.map(it => {
      if (it.id === id && !it.locked) {
        return { ...it, rotation: ((it.rotation || 0) + 15) % 360 };
      }
      return it;
    }));
  };

  // Dragging state
  const draggingRef = useRef<{
    ids: string[];
    startX: number;
    startY: number;
    origItems: TlorisPostavka[];
    moved: boolean;
    target: Element;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    if (activeTool !== 'select') return;
    e.stopPropagation();

    // Focus container to capture keyboard events properly
    containerRef.current?.focus({ preventScroll: true });

    const item = doc?.items.find(i => i.id === id);
    if (!item) return;

    let newSel = selectedIds;
    if (!selectedIds.includes(id)) {
      newSel = e.shiftKey ? [...selectedIds, id] : [id];
      setSelectedIds(newSel);
    } else if (e.shiftKey) {
      newSel = selectedIds.filter(x => x !== id);
      setSelectedIds(newSel);
      return;
    }

    if (item.locked) return;
    if (!doc) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = doc.width / rect.width;
    const scaleY = doc.height / rect.height;

    draggingRef.current = {
      ids: newSel,
      startX: e.clientX * scaleX,
      startY: e.clientY * scaleY,
      origItems: doc.items.filter(i => newSel.includes(i.id)),
      moved: false,
      target: e.currentTarget as Element
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (resizeRef.current && doc) {
      const { id, startX, startY, origW, origH, rotation } = resizeRef.current;
      const rect = canvasRef.current!.getBoundingClientRect();
      const scaleX = doc.width / rect.width;
      const scaleY = doc.height / rect.height;

      const rawDx = e.clientX * scaleX - startX;
      const rawDy = e.clientY * scaleY - startY;

      const angle = rotation * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const localDx = rawDx * cos + rawDy * sin;
      const localDy = -rawDx * sin + rawDy * cos;

      setDoc(prev => {
        if (!prev) return prev;
        const newItems = prev.items.map(it => {
          if (it.id === id) {
            let nw = origW + localDx;
            let nh = origH + localDy;
            if (snapToGrid) {
              nw = snap(nw, prev.gridSize);
              nh = snap(nh, prev.gridSize);
            }
            nw = Math.max(10, nw);
            nh = Math.max(10, nh);

            if (it.x + nw > prev.width) nw = prev.width - it.x;
            if (it.y + nh > prev.height) nh = prev.height - it.y;

            return { ...it, width: nw, height: nh };
          }
          return it;
        });
        return { ...prev, items: newItems };
      });
      return;
    }

    const dragging = draggingRef.current;
    if (dragging && doc) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const scaleX = doc.width / rect.width;
      const scaleY = doc.height / rect.height;
      const dx = e.clientX * scaleX - dragging.startX;
      const dy = e.clientY * scaleY - dragging.startY;

      if (!dragging.moved && Math.sqrt(dx*dx + dy*dy) > 3) {
        dragging.moved = true;
      }

      if (dragging.moved) {
        const draggedIds = new Set(dragging.ids);
        const originalItems = new Map(dragging.origItems.map(item => [item.id, item]));
        setDoc(prev => {
          if (!prev) return prev;
          const newItems = prev.items.map(it => {
            if (draggedIds.has(it.id)) {
              const orig = originalItems.get(it.id);
              if (!orig) return it;
              let nx = snap(orig.x + dx, prev.gridSize);
              let ny = snap(orig.y + dy, prev.gridSize);
              if (nx < 0) nx = 0;
              if (ny < 0) ny = 0;
              if (nx + it.width > prev.width) nx = Math.max(0, prev.width - it.width);
              if (ny + it.height > prev.height) ny = Math.max(0, prev.height - it.height);
              return {
                ...it,
                x: nx,
                y: ny
              };
            }
            return it;
          });
          return { ...prev, items: newItems };
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (resizeRef.current && doc) {
      const target = resizeRef.current.target;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      setDoc(prev => {
        if (prev) pushHistory(prev);
        return prev;
      });
      resizeRef.current = null;
      return;
    }

    if (draggingRef.current && doc) {
      const target = draggingRef.current.target;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      if (draggingRef.current.moved) {
        setDoc(prev => {
          if (prev) pushHistory(prev);
          return prev;
        });
      }
      draggingRef.current = null;
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!doc) return;

    if (e.target !== e.currentTarget) return;

    if (activeTool === 'select') {
      setSelectedIds([]);
      return;
    }

    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = doc.width / rect.width;
    const scaleY = doc.height / rect.height;
    const rawX = (e.clientX - rect.left) * scaleX;
    const rawY = (e.clientY - rect.top) * scaleY;

    const maxZ = doc.items.reduce((m, i) => Math.max(m, i.zIndex), 0);
    const newItem: TlorisPostavka = {
      id: generateId(),
      kind: activeTool as TlorisPostavkaKind,
      x: rawX, y: rawY,
      width: 100, height: 100, rotation: 0, zIndex: maxZ + 1,
      locked: false, visible: true, style: {}, data: {}
    };

    if (activeTool === 'wall') { newItem.width = 200; newItem.height = 20; newItem.style.backgroundColor = '#1c1917'; }
    if (activeTool === 'door') { newItem.width = 80; newItem.height = 20; }
    if (activeTool === 'opening') { newItem.width = 80; newItem.height = 20; }
    if (activeTool === 'label') { newItem.width = 150; newItem.height = 40; newItem.data.text = 'Oznaka'; newItem.data.fontSize = 24; }
    if (activeTool === 'zone') { newItem.width = 200; newItem.height = 200; newItem.style.backgroundColor = '#e2e8f0'; newItem.data.name = 'Cona'; newItem.zIndex = 0; }
    if (activeTool === 'decoration') { newItem.width = 50; newItem.height = 50; newItem.data.type = 'plant'; }

    newItem.x = snap(newItem.x - newItem.width / 2, doc.gridSize);
    newItem.y = snap(newItem.y - newItem.height / 2, doc.gridSize);

    updateItems(items => [...items, newItem]);
    setSelectedIds([newItem.id]);
    setActiveTool('select');
  };

  const confirmDelete = () => {
    updateItems(items => items.filter(i => !selectedIds.includes(i.id) || i.kind === 'table'));
    setSelectedIds([]);
    setDeleteConfirmOpen(false);
  };

  const handleSave = () => {
    if (!doc) return;

    const payload: TlorisInput = {
      version: doc.version,
      width: doc.width,
      height: doc.height,
      gridSize: doc.gridSize,
      items: doc.items
    };

    updateTloris.mutate({ id: prostorId, data: payload }, {
      onSuccess: (savedDoc) => {
        setDoc(savedDoc);
        setHistory([savedDoc]);
        setHistoryIdx(0);
        setLastSavedIdx(0);
        queryClient.invalidateQueries({ queryKey: getGetProstorTlorisQueryKey(prostorId) });
        toast({ title: "Tloris shranjen" });
      },
      onError: (err: any) => {
        if (err.status === 409) {
          toast({
            title: "Konflikt različic",
            description: "Tloris je bil vmes spremenjen na drugem zaslonu. Osvežite stran.",
            variant: "destructive"
          });
        } else {
          toast({ title: "Napaka", description: "Shranjevanje tlorisa ni uspelo.", variant: "destructive" });
        }
      }
    });
  };

  const handleReset = () => {
    if (!doc) return;
    resetTloris.mutate({ id: prostorId, data: { version: doc.version } }, {
      onSuccess: (savedDoc) => {
        setDoc(savedDoc);
        setHistory([savedDoc]);
        setHistoryIdx(0);
        setLastSavedIdx(0);
        queryClient.invalidateQueries({ queryKey: getGetProstorTlorisQueryKey(prostorId) });
        setResetConfirmOpen(false);
        toast({ title: "Tloris ponastavljen" });
      },
      onError: () => toast({ title: "Napaka", description: "Ni bilo mogoče ponastaviti tlorisa.", variant: "destructive" })
    });
  };

  const isDirty = historyIdx !== lastSavedIdx;
  const selectedItem = doc?.items.find(i => i.id === selectedIds[0]);
  const sortedItems = doc ? [...doc.items].sort((a, b) => a.zIndex - b.zIndex) : [];

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-[calc(100dvh+16rem)] min-h-[860px] max-h-[1400px] border rounded-xl bg-card overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      tabIndex={-1}
    >
      <div className="flex flex-1 min-h-0">
        {/* Toolbar Left */}
        <div className="w-24 bg-card border-r flex flex-col p-1.5 gap-1.5 overflow-y-auto shrink-0 shadow-[4px_0_10px_rgba(0,0,0,0.02)] z-10 [&_button]:px-1 [&_button]:text-[9px] [&_button]:whitespace-normal [&_button]:leading-tight">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 mt-1 px-1">Orodja</div>

          <Button
            variant="ghost"
            className={cn("w-full justify-start h-10 text-sm font-medium transition-colors", activeTool === 'select' ? "bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary" : "text-muted-foreground hover:bg-muted")}
            onClick={() => setActiveTool('select')}
            disabled={!doc}
            title="Izbira elementov (V, Esc)"
          >
            <MousePointer2 className="w-3.5 h-3.5 mr-1 shrink-0" /> Izbira
          </Button>

          <div className="my-1.5 h-px bg-border/50 mx-1" />

          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 px-1">Arhitektura</div>
          <Button variant="ghost" className={cn("w-full justify-start h-10 text-sm transition-colors", activeTool === 'wall' ? "bg-primary/15 text-primary hover:bg-primary/25" : "text-muted-foreground hover:bg-muted")} onClick={() => setActiveTool('wall')} disabled={!doc}>
            <Square className="w-3.5 h-3.5 mr-1 shrink-0" /> Zid
          </Button>
          <Button variant="ghost" className={cn("w-full justify-start h-10 text-sm transition-colors", activeTool === 'door' ? "bg-primary/15 text-primary hover:bg-primary/25" : "text-muted-foreground hover:bg-muted")} onClick={() => setActiveTool('door')} disabled={!doc}>
            <Move className="w-3.5 h-3.5 mr-1 shrink-0" /> Vrata
          </Button>
          <Button variant="ghost" className={cn("w-full justify-start h-10 text-sm transition-colors", activeTool === 'opening' ? "bg-primary/15 text-primary hover:bg-primary/25" : "text-muted-foreground hover:bg-muted")} onClick={() => setActiveTool('opening')} disabled={!doc}>
            <GripHorizontal className="w-3.5 h-3.5 mr-1 shrink-0" /> Odprtina
          </Button>

          <div className="my-1.5 h-px bg-border/50 mx-1" />

          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 px-1">Dodatki</div>
          <Button variant="ghost" className={cn("w-full justify-start h-10 text-sm transition-colors", activeTool === 'label' ? "bg-primary/15 text-primary hover:bg-primary/25" : "text-muted-foreground hover:bg-muted")} onClick={() => setActiveTool('label')} disabled={!doc}>
            <Type className="w-3.5 h-3.5 mr-1 shrink-0" /> Oznaka (Tekst)
          </Button>
          <Button variant="ghost" className={cn("w-full justify-start h-10 text-sm transition-colors", activeTool === 'zone' ? "bg-primary/15 text-primary hover:bg-primary/25" : "text-muted-foreground hover:bg-muted")} onClick={() => setActiveTool('zone')} disabled={!doc}>
            <LayoutGrid className="w-3.5 h-3.5 mr-1 shrink-0" /> Cona
          </Button>
          <Button variant="ghost" className={cn("w-full justify-start h-10 text-sm transition-colors", activeTool === 'decoration' ? "bg-primary/15 text-primary hover:bg-primary/25" : "text-muted-foreground hover:bg-muted")} onClick={() => setActiveTool('decoration')} disabled={!doc}>
            <Circle className="w-3.5 h-3.5 mr-1 shrink-0" /> Dekoracija
          </Button>
        </div>

        {/* Canvas Area */}
        <div
          className="flex-1 bg-stone-100 dark:bg-stone-900/50 relative overflow-auto min-h-0 p-4 flex"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {!doc ? (
            <div className="m-auto flex flex-col items-center justify-center p-12 text-muted-foreground">
              <div className="w-10 h-10 mb-4 rounded-full border-4 border-t-primary border-r-primary border-b-transparent border-l-transparent animate-spin" />
              <p className="font-medium">Nalagam tloris...</p>
            </div>
          ) : (
            <div
              ref={canvasRef}
              className="m-auto relative bg-white dark:bg-stone-950 shadow-md ring-1 ring-border touch-none shrink-0"
              style={{ width: doc.width, height: doc.height, transformOrigin: 'center center' }}
              onClick={handleCanvasClick}
              data-canvas-bg="true"
            >
              {/* Grid pattern */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
                <defs>
                  <pattern id="tloris-grid" x="0" y="0" width={doc.gridSize} height={doc.gridSize} patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="1" className="fill-stone-300 dark:fill-stone-700" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#tloris-grid)" />
              </svg>

              {sortedItems.map(item => {
                const isSelected = selectedIds.includes(item.id);
                const miza = item.kind === 'table' ? mize.find(m => m.id === item.tableId) : null;
                const s = item.style || {};
                const d = item.data || {};

                let content = null;
                let bgClass = "";
                let borderClass = "";
                let shapeClass = "";

                if (item.kind === 'table') {
                  const oblika = d.oblika || 'pravokotnik_h';
                  bgClass = "bg-stone-50 dark:bg-stone-900";
                  borderClass = "border-2 border-stone-800 dark:border-stone-700";
                  shapeClass = oblika === 'okrogla' ? 'rounded-full' : 'rounded-md';
                  content = (
                    <div className="flex flex-col items-center">
                      <span className="font-bold text-xs text-stone-900 dark:text-stone-100">{miza?.ime || `M${miza?.stevilka}`}</span>
                      <span className="text-[10px] text-stone-500">{miza?.kapaciteta}x</span>
                    </div>
                  );
                } else if (item.kind === 'wall') {
                  bgClass = s.backgroundColor as string === '#1c1917' ? "bg-stone-900" : (s.backgroundColor as string === '#78716c' ? "bg-stone-500" : "bg-stone-300");
                  borderClass = "border-none";
                } else if (item.kind === 'door') {
                  bgClass = "bg-amber-700/80";
                  borderClass = "border border-amber-900";
                } else if (item.kind === 'opening') {
                  bgClass = "bg-transparent";
                  borderClass = "border-2 border-dashed border-stone-400";
                } else if (item.kind === 'zone') {
                  borderClass = "border-2 border-dashed";
                  content = <span className="font-bold text-lg pointer-events-none" style={{ color: s.color as string || '#000' }}>{d.name as string}</span>;
                } else if (item.kind === 'label') {
                  bgClass = "bg-transparent";
                  content = <span className="font-semibold whitespace-nowrap" style={{ fontSize: `${d.fontSize || 14}px`, color: s.color as string || '#000' }}>{d.text as string}</span>;
                } else if (item.kind === 'decoration') {
                  if (d.type === 'plant') {
                    bgClass = "bg-emerald-600 opacity-80";
                    borderClass = "border-2 border-emerald-800";
                    shapeClass = "rounded-full";
                  } else if (d.type === 'register') {
                    bgClass = "bg-stone-300 dark:bg-stone-800";
                    borderClass = "border-2 border-stone-500";
                    shapeClass = "rounded";
                    content = <span className="text-xs font-bold text-stone-700 dark:text-stone-300">POS</span>;
                  } else {
                    bgClass = "bg-stone-200 dark:bg-stone-800";
                    borderClass = "border-2 border-stone-400";
                  }
                }

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "absolute flex items-center justify-center transition-shadow",
                      item.locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                      bgClass, borderClass, shapeClass,
                      !item.visible && "opacity-20",
                      isSelected && "ring-4 ring-primary ring-offset-1 shadow-xl"
                    )}
                    style={{
                      left: item.x, top: item.y, width: item.width, height: item.height,
                      transform: `rotate(${item.rotation || 0}deg)`,
                      zIndex: isSelected ? 50 : item.zIndex,
                      backgroundColor: item.kind === 'zone' || item.kind === 'wall' ? (s.backgroundColor as string || (item.kind === 'wall' ? '#1c1917' : '#ccc')) : undefined,
                      opacity: item.kind === 'zone' ? 0.3 : undefined,
                    }}
                    onPointerDown={e => handlePointerDown(e, item.id)}
                    onClick={e => e.stopPropagation()} // Prevent bubble to canvas
                  >
                    {content && (
                      <div style={{ transform: `rotate(-${item.rotation || 0}deg)` }} className="pointer-events-none">
                        {content}
                      </div>
                    )}

                    {/* Status Indicators */}
                    {item.locked && (
                      <div className="absolute -top-2 -right-2 bg-background border rounded-full p-0.5 shadow-sm text-muted-foreground z-10 pointer-events-none">
                        <Lock className="w-3 h-3" />
                      </div>
                    )}
                    {!item.visible && (
                      <div className="absolute -top-2 -left-2 bg-background border rounded-full p-0.5 shadow-sm text-muted-foreground z-10 pointer-events-none">
                        <EyeOff className="w-3 h-3" />
                      </div>
                    )}

                    {/* Direct Manipulation Handles */}
                    {isSelected && !item.locked && (
                      <>
                        <div
                          className="absolute -top-8 left-1/2 -translate-x-1/2 w-7 h-7 bg-background border rounded-full shadow flex items-center justify-center cursor-pointer text-foreground hover:bg-muted hover:text-primary z-50 pointer-events-auto touch-none"
                          title="Zavrti za 15° (Rotate)"
                          aria-label="Zavrti za 15°"
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => handleRotateClick(e, item.id)}
                        >
                          <RotateCw className="w-3.5 h-3.5" style={{ transform: `rotate(-${item.rotation || 0}deg)` }} />
                        </div>

                        <div
                          className="absolute -right-3 -bottom-3 w-7 h-7 bg-primary border-2 border-background rounded-full shadow-sm z-50 pointer-events-auto flex items-center justify-center touch-none"
                          style={{ cursor: 'nwse-resize' }}
                          title="Spremeni velikost (Resize)"
                          aria-label="Spremeni velikost"
                          onPointerDown={e => handleResizePointerDown(e, item.id)}
                          onClick={e => e.stopPropagation()}
                        >
                          <div
                            className="w-1.5 h-1.5 bg-primary-foreground rounded-full pointer-events-none"
                            style={{ transform: `rotate(-${item.rotation || 0}deg)` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Properties Panel Bottom */}
      <div className="h-64 sm:h-72 border-t flex flex-col bg-background shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] relative z-20">
        <div className="flex flex-wrap items-center justify-between px-4 py-2 border-b bg-muted/40 shrink-0 gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={undo} disabled={historyIdx <= 0 || !doc} title="Razveljavi (Undo)"><Undo className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={redo} disabled={historyIdx >= history.length - 1 || !doc} title="Uveljavi (Redo)"><Redo className="w-4 h-4" /></Button>
            <div className="w-px h-5 bg-border mx-1 shrink-0" />

            {selectedItem ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium whitespace-nowrap">
                  Izbrano: <span className="text-primary">{selectedItem.kind === 'table' ? formatMizaLabel(mize.find(m => m.id === selectedItem.tableId)?.ime || String(selectedItem.tableId)) : selectedItem.kind}</span>
                </span>
                <div className="flex items-center gap-1 ml-2 bg-background rounded-md p-0.5 border shadow-sm shrink-0">
                  <Button size="icon" variant="ghost" className={cn("h-6 w-6 rounded-sm", selectedItem.locked && 'bg-primary/15 text-primary hover:text-primary')} onClick={() => updateItems(its => itM(its, selectedItem.id, { locked: !selectedItem.locked }))} title="Zakleni/Odkleni element">
                    {selectedItem.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" className={cn("h-6 w-6 rounded-sm", !selectedItem.visible && 'bg-primary/15 text-primary hover:text-primary')} onClick={() => updateItems(its => itM(its, selectedItem.id, { visible: !selectedItem.visible }))} title="Skrij/Prikaži element">
                    {selectedItem.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground whitespace-nowrap">Ni izbranega elementa</span>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {selectedItem && selectedItem.kind !== 'table' && (
              <>
                <Button size="sm" variant="outline" className="h-8" onClick={() => {
                  const dup = { ...selectedItem, id: generateId(), x: selectedItem.x + 20, y: selectedItem.y + 20 };
                  updateItems(its => [...its, dup]);
                  setSelectedIds([dup.id]);
                }} title="Podvoji element">
                  <Copy className="w-4 h-4 mr-1.5" /> Podvoji
                </Button>
                <Button size="sm" variant="destructive" className="h-8 shadow-sm" onClick={() => setDeleteConfirmOpen(true)} title="Izbriši izbrani element">
                  <Trash2 className="w-4 h-4 mr-1.5" /> Izbriši
                </Button>
              </>
            )}
            <div className="w-px h-5 bg-border mx-1 shrink-0" />
            <Button size="sm" className="h-8 min-w-[140px] transition-all" onClick={handleSave} disabled={updateTloris.isPending || !doc || !isDirty}>
              <Save className="w-4 h-4 mr-1.5 shrink-0" />
              {isDirty ? 'Shrani spremembe' : 'Shranjeno'}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {selectedItem && doc ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 xl:gap-8">
              {/* Position & Size */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2 border-b pb-1.5"><Move className="w-3.5 h-3.5" /> Pozicija & Velikost</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">X pozicija (px)</Label><DeferredNumberInput className="h-9" value={selectedItem.x} min={0} onCommit={value => updateItems(its => itM(its, selectedItem.id, { x: value }))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Y pozicija (px)</Label><DeferredNumberInput className="h-9" value={selectedItem.y} min={0} onCommit={value => updateItems(its => itM(its, selectedItem.id, { y: value }))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Širina</Label><DeferredNumberInput className="h-9" value={selectedItem.width} min={10} onCommit={value => updateItems(its => itM(its, selectedItem.id, { width: value }))} /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Višina</Label><DeferredNumberInput className="h-9" value={selectedItem.height} min={10} onCommit={value => updateItems(its => itM(its, selectedItem.id, { height: value }))} /></div>
                </div>
              </div>

              {/* Orientation & Layer */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2 border-b pb-1.5"><RotateCcw className="w-3.5 h-3.5" /> Usmeritev & Sloj</h4>
                <div className="grid grid-cols-1 gap-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Rotacija (stopinje)</Label>
                    <div className="flex items-center gap-2">
                      <DeferredNumberInput className="h-9 flex-1" value={selectedItem.rotation} onCommit={value => updateItems(its => itM(its, selectedItem.id, { rotation: value }))} />
                      <Button variant="outline" size="sm" className="h-9 shrink-0 px-3" onClick={() => updateItems(its => itM(its, selectedItem.id, { rotation: (selectedItem.rotation + 90) % 360 }))}>+90°</Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground flex justify-between">Z-index (Sloj) <span className="font-medium text-foreground">{selectedItem.zIndex}</span></Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => updateItems(its => itM(its, selectedItem.id, { zIndex: selectedItem.zIndex - 1 }))}>Nižje</Button>
                      <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => updateItems(its => itM(its, selectedItem.id, { zIndex: selectedItem.zIndex + 1 }))}>Višje</Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Type Specific */}
              <div className="space-y-4 col-span-1 md:col-span-2 xl:col-span-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2 border-b pb-1.5">
                  <PaintBucket className="w-3.5 h-3.5" />
                  Lastnosti: {selectedItem.kind}
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-2 gap-x-6 gap-y-3">
                  {selectedItem.kind === 'table' && (
                    <div className="space-y-1.5 col-span-2 sm:col-span-1">
                      <Label className="text-xs text-muted-foreground">Oblika mize</Label>
                      <Select
                        value={selectedItem.data.oblika as string || 'pravokotnik_h'}
                        onValueChange={value => {
                          if (!doc) return;
                          const shape = value as TableShape;
                          updateItems(items => items.map(item =>
                            item.id === selectedItem.id
                              ? applyTableShape(item, shape, doc.width, doc.height)
                              : item
                          ));
                        }}
                      >
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pravokotnik_h">Pravokotnik (ležeč)</SelectItem>
                          <SelectItem value="pravokotnik_v">Pravokotnik (pokončen)</SelectItem>
                          <SelectItem value="kvadrat">Kvadrat</SelectItem>
                          <SelectItem value="okrogla">Okrogla</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {(selectedItem.kind === 'door' || selectedItem.kind === 'opening') && (
                    <div className="space-y-1.5 col-span-2 sm:col-span-1">
                      <Label className="text-xs text-muted-foreground">Usmeritev</Label>
                      <Select value={(selectedItem.rotation % 180).toString()} onValueChange={v => updateItems(its => itM(its, selectedItem.id, { rotation: Number(v) }))}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Vodoravno</SelectItem>
                          <SelectItem value="90">Navpično</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {selectedItem.kind === 'wall' && (
                    <>
                      <div className="space-y-1.5 col-span-2 sm:col-span-1">
                        <Label className="text-xs text-muted-foreground">Stil / Barva zidu</Label>
                        <Select value={selectedItem.style.backgroundColor as string || '#1c1917'} onValueChange={v => updateItems(its => itM(its, selectedItem.id, { style: { ...selectedItem.style, backgroundColor: v } }))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="#1c1917">Nosilna stena (črna)</SelectItem>
                            <SelectItem value="#78716c">Pregradna stena (siva)</SelectItem>
                            <SelectItem value="#d6d3d1">Nizka stena / šank (svetla)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 col-span-2 sm:col-span-1">
                        <Label className="text-xs text-muted-foreground flex justify-between">Debelina zidu <span>{selectedItem.height}px</span></Label>
                        <div className="h-9 flex items-center px-1">
                          <Slider
                            value={[selectedItem.height]}
                            min={5} max={100} step={1}
                            onValueChange={v => updateItems(its => itM(its, selectedItem.id, { height: v[0] }))}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {selectedItem.kind === 'label' && (
                    <>
                      <div className="space-y-1.5 col-span-2"><Label className="text-xs text-muted-foreground">Besedilo</Label><Input className="h-9" value={selectedItem.data.text as string} onChange={e => updateItems(its => itM(its, selectedItem.id, { data: { ...selectedItem.data, text: e.target.value } }))} /></div>
                      <div className="space-y-1.5 col-span-2 sm:col-span-1">
                        <Label className="text-xs text-muted-foreground">Velikost pisave (px)</Label>
                        <DeferredNumberInput className="h-9" value={selectedItem.data.fontSize as number || 14} min={1} onCommit={value => updateItems(its => itM(its, selectedItem.id, { data: { ...selectedItem.data, fontSize: value } }))} />
                      </div>
                      <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Barva besedila</Label><Input type="color" value={selectedItem.style.color as string || '#000000'} onChange={e => updateItems(its => itM(its, selectedItem.id, { style: { ...selectedItem.style, color: e.target.value } }))} className="h-9 p-0.5 w-full block cursor-pointer rounded-md border" /></div>
                    </>
                  )}

                  {selectedItem.kind === 'zone' && (
                    <>
                      <div className="space-y-1.5 col-span-2"><Label className="text-xs text-muted-foreground">Ime cone</Label><Input className="h-9" value={selectedItem.data.name as string} onChange={e => updateItems(its => itM(its, selectedItem.id, { data: { ...selectedItem.data, name: e.target.value } }))} /></div>
                      <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Barva obrobe</Label><Input type="color" value={selectedItem.style.color as string || '#000000'} onChange={e => updateItems(its => itM(its, selectedItem.id, { style: { ...selectedItem.style, color: e.target.value } }))} className="h-9 p-0.5 w-full block cursor-pointer rounded-md border" /></div>
                      <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Barva ozadja</Label><Input type="color" value={selectedItem.style.backgroundColor as string || '#e2e8f0'} onChange={e => updateItems(its => itM(its, selectedItem.id, { style: { ...selectedItem.style, backgroundColor: e.target.value } }))} className="h-9 p-0.5 w-full block cursor-pointer rounded-md border" /></div>
                    </>
                  )}

                  {selectedItem.kind === 'decoration' && (
                    <div className="space-y-1.5 col-span-2 sm:col-span-1">
                      <Label className="text-xs text-muted-foreground">Tip dekoracije</Label>
                      <Select value={selectedItem.data.type as string || 'plant'} onValueChange={v => updateItems(its => itM(its, selectedItem.id, { data: { ...selectedItem.data, type: v } }))}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="plant">Rastlina</SelectItem>
                          <SelectItem value="register">POS blagajna</SelectItem>
                          <SelectItem value="box">Škatla / ovira</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : doc ? (
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-8">
              <div className="space-y-4 md:col-span-2 xl:col-span-1">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2 border-b pb-1.5">Nastavitve platna</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Širina platna</Label><DeferredNumberInput className="h-9" value={doc.width} min={100} onCommit={value => updateCanvas({ width: value })} /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Višina platna</Label><DeferredNumberInput className="h-9" value={doc.height} min={100} onCommit={value => updateCanvas({ height: value })} /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Velikost mreže</Label><DeferredNumberInput className="h-9" value={doc.gridSize} min={5} onCommit={value => updateCanvas({ gridSize: value })} /></div>
                  <div className="flex flex-col justify-center space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Pripni na mrežo</Label>
                    <div className="h-9 flex items-center">
                      <Switch checked={snapToGrid} onCheckedChange={setSnapToGrid} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2 border-b pb-1.5 text-destructive">Nevarna območja</h4>
                <Button variant="outline" className="w-full h-10 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setResetConfirmOpen(true)} disabled={resetTloris.isPending}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Ponastavi tloris
                </Button>
                <p className="text-[11px] text-muted-foreground leading-tight text-center px-2">S tem boste izbrisali vse zidove in oznake ter samodejno razvrstili mize.</p>
              </div>

              <div className="space-y-3 md:col-span-3 xl:col-span-2 flex flex-col justify-center items-center">
                <div className="rounded-xl border bg-muted/40 p-5 text-sm text-muted-foreground text-center max-w-lg w-full">
                  <p className="font-medium text-foreground">Za urejanje izberite element na platnu s klikom.</p>
                  <p className="text-xs mt-1.5">Uporabite orodno vrstico na levi za dodajanje novih zidov, vrat, con in oznak.</p>
                  <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 mt-4 pt-4 border-t border-border/50">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium"><kbd className="bg-background border shadow-sm px-1.5 py-0.5 rounded text-[10px] text-foreground font-mono">Del</kbd> Izbriši</span>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium"><kbd className="bg-background border shadow-sm px-1.5 py-0.5 rounded text-[10px] text-foreground font-mono">Esc</kbd> Prekliči izbiro</span>
                    <span className="flex items-center gap-1.5 text-[11px] font-medium"><kbd className="bg-background border shadow-sm px-1.5 py-0.5 rounded text-[10px] text-foreground font-mono">Puščice</kbd> Premik (Shift za 10px)</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbrišem izbrane elemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Ste prepričani, da želite izbrisati izbrane elemente? Mize ne bodo izbrisane.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Izbriši
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ponastavim tloris prostora?</AlertDialogTitle>
            <AlertDialogDescription>
              S tem boste trajno ponastavili celoten tloris na izhodiščno stanje. Zidovi, cone in oznake bodo izbrisani,
              mize pa bodo samodejno razporejene v mrežo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} disabled={resetTloris.isPending}>
              Ponastavi tloris
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
