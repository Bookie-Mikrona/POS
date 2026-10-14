import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyTableShape, TlorisEditor } from './TlorisEditor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as apiClient from '@workspace/api-client-react';

if (!window.HTMLElement.prototype.setPointerCapture) {
  window.HTMLElement.prototype.setPointerCapture = function() {};
  window.HTMLElement.prototype.releasePointerCapture = function() {};
  window.HTMLElement.prototype.hasPointerCapture = function() { return false; };
}
if (!global.ResizeObserver) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock('@workspace/api-client-react', async () => {
  return {
    useGetProstorTloris: vi.fn(),
    useUpdateProstorTloris: vi.fn(),
    useResetProstorTloris: vi.fn(),
    getGetProstorTlorisQueryKey: vi.fn(),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() })
}));

describe('TlorisEditor focused interactions', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    
    // Mock the hook returns
    (apiClient.useGetProstorTloris as any).mockReturnValue({
      data: {
        version: 1,
        width: 800,
        height: 600,
        gridSize: 25,
        items: [
          {
            id: 'item-1',
            kind: 'table',
            tableId: 101,
            x: 100, y: 100, width: 50, height: 50,
            rotation: 0, zIndex: 10, locked: false, visible: true,
            style: {}, data: { oblika: 'pravokotnik_h' }
          },
          {
            id: 'item-2',
            kind: 'wall',
            x: 200, y: 200, width: 200, height: 10,
            rotation: 0, zIndex: 5, locked: true, visible: true,
            style: { backgroundColor: '#1c1917' }, data: {}
          }
        ]
      },
      isFetching: false
    });
    
    (apiClient.useUpdateProstorTloris as any).mockReturnValue({
      mutate: vi.fn(),
      isPending: false
    });
    
    (apiClient.useResetProstorTloris as any).mockReturnValue({
      mutate: vi.fn(),
      isPending: false
    });
  });

  it.each([
    ['pravokotnik_h', 125, 75],
    ['pravokotnik_v', 75, 125],
    ['kvadrat', 100, 100],
    ['okrogla', 100, 100],
  ] as const)('changes table geometry when shape becomes %s', (shape, width, height) => {
    const item = {
      id: 'table-shape',
      kind: 'table',
      tableId: 101,
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      rotation: 0,
      zIndex: 10,
      locked: false,
      visible: true,
      style: {},
      data: { oblika: 'pravokotnik_h' },
    } as any;

    const changed = applyTableShape(item, shape, 800, 600);

    expect(changed.width).toBe(width);
    expect(changed.height).toBe(height);
    expect(Math.abs((changed.x + changed.width / 2) - (item.x + item.width / 2))).toBeLessThanOrEqual(0.5);
    expect(Math.abs((changed.y + changed.height / 2) - (item.y + item.height / 2))).toBeLessThanOrEqual(0.5);
    expect(changed.data.oblika).toBe(shape);
  });

  it('selects an unlocked item, deselects on canvas click, selects locked item', async () => {
    const mize = [{ id: 101, stevilka: 1, kapaciteta: 4, ime: 'Miza 1' }];
    
    render(
      <QueryClientProvider client={queryClient}>
        <TlorisEditor prostorId={1} mize={mize as any} />
      </QueryClientProvider>
    );

    // Assert initial state: nothing selected
    expect(screen.queryByText('Izbrano:')).not.toBeInTheDocument();
    
    // 1. Click unlocked item (table)
    const tableItem = screen.getByText('Miza 1').closest('div[style*="left: 100px"]');
    expect(tableItem).toBeInTheDocument();
    
    if (tableItem) {
      // Simulate pointer down to select
      fireEvent.pointerDown(tableItem, { clientX: 110, clientY: 110, pointerId: 1 });
      
      // Assert selection
      expect(screen.getByText('Izbrano:')).toBeInTheDocument();
      expect(screen.getAllByText('Miza 1').length).toBeGreaterThan(1);
    }

    // 2. Click empty canvas to deselect
    const canvas = document.querySelector('[data-canvas-bg="true"]');
    expect(canvas).toBeInTheDocument();
    
    if (canvas) {
      fireEvent.click(canvas);
      
      // Assert deselection
      expect(screen.getAllByText('Miza 1')).toHaveLength(1);
      expect(screen.getByText('Ni izbranega elementa')).toBeInTheDocument();
    }

    // 3. Click locked item (wall)
    // Find the wall by its inline styles (left: 200px)
    const wallItem = document.querySelector('div[style*="left: 200px"][style*="top: 200px"]');
    expect(wallItem).toBeInTheDocument();
    
    if (wallItem) {
      fireEvent.pointerDown(wallItem, { clientX: 210, clientY: 210, pointerId: 2 });
      
      // Assert it gets selected (locked items can be selected but not dragged)
      expect(screen.getByText('Izbrano:')).toBeInTheDocument();
      expect(screen.getByText('wall')).toBeInTheDocument();
    }
  });

  it('allows resizing an unlocked item via bottom-right handle and keeps selection', async () => {
    // Mock getBoundingClientRect
    window.HTMLElement.prototype.getBoundingClientRect = function() {
      return { width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0, toJSON: () => {} };
    };
    
    const mize = [{ id: 101, stevilka: 1, kapaciteta: 4, ime: 'Miza 1' }];
    render(
      <QueryClientProvider client={queryClient}>
        <TlorisEditor prostorId={1} mize={mize as any} />
      </QueryClientProvider>
    );

    // Select the table
    const tableItem = screen.getByText('Miza 1').closest('div[style*="left: 100px"]');
    expect(tableItem).toBeInTheDocument();
    
    if (tableItem) {
      fireEvent.pointerDown(tableItem, { clientX: 110, clientY: 110, pointerId: 1 });
      expect(screen.getByText('Izbrano:')).toBeInTheDocument();
      
      // Find the resize handle by title
      const resizeHandle = screen.getByTitle('Spremeni velikost (Resize)');
      expect(resizeHandle).toBeInTheDocument();

      // Trigger pointer down on the handle
      fireEvent.pointerDown(resizeHandle, { clientX: 150, clientY: 150, pointerId: 2 });
      
      const canvasArea = document.querySelector('[data-canvas-bg="true"]')?.parentElement;
      expect(canvasArea).toBeInTheDocument();
      
      if (canvasArea) {
        // Move to trigger resize
        fireEvent.pointerMove(canvasArea, { clientX: 200, clientY: 200, pointerId: 2 });
        fireEvent.pointerUp(canvasArea, { clientX: 200, clientY: 200, pointerId: 2 });
      }
      
      // Assert selection is kept
      expect(screen.getByText('Izbrano:')).toBeInTheDocument();
      
      // Verify width/height inputs show increased sizes
      // original w:50 h:50, dx:50 dy:50 => new w:100 h:100
      const spinbuttons = screen.getAllByRole('spinbutton');
      const widthInput = spinbuttons.find(el => (el as HTMLInputElement).value === '100');
      expect(widthInput).toBeInTheDocument();
    }
  });

  it('allows typing 400 into a dimension field before applying its minimum', () => {
    const mize = [{ id: 101, stevilka: 1, kapaciteta: 4, ime: 'Miza 1' }];
    render(
      <QueryClientProvider client={queryClient}>
        <TlorisEditor prostorId={1} mize={mize as any} />
      </QueryClientProvider>
    );

    const tableItem = screen.getByText('Miza 1').closest('div[style*="left: 100px"]');
    expect(tableItem).toBeInTheDocument();
    fireEvent.pointerDown(tableItem!, { clientX: 110, clientY: 110, pointerId: 1 });

    const widthInput = screen.getByText('Širina').parentElement?.querySelector('input');
    expect(widthInput).toBeInTheDocument();

    fireEvent.focus(widthInput!);
    fireEvent.change(widthInput!, { target: { value: '' } });
    fireEvent.change(widthInput!, { target: { value: '4' } });
    expect(widthInput).toHaveValue(4);
    fireEvent.change(widthInput!, { target: { value: '400' } });
    expect(widthInput).toHaveValue(400);
    fireEvent.blur(widthInput!);

    expect(widthInput).toHaveValue(400);
  });

  it('shows a table added while the editor is already open', () => {
    const initialMize = [{ id: 101, stevilka: 1, kapaciteta: 4, ime: 'Miza 1' }];
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TlorisEditor prostorId={1} mize={initialMize as any} />
      </QueryClientProvider>
    );

    expect(screen.queryByText('Miza 2')).not.toBeInTheDocument();

    const updatedMize = [
      ...initialMize,
      {
        id: 102,
        stevilka: 2,
        kapaciteta: 4,
        ime: 'Miza 2',
        posX: 235,
        posY: 160,
        tlorisSirina: 125,
        tlorisVisina: 75,
        tlorisRotacija: 0,
        oblika: 'pravokotnik_h',
      },
    ];
    rerender(
      <QueryClientProvider client={queryClient}>
        <TlorisEditor prostorId={1} mize={updatedMize as any} />
      </QueryClientProvider>
    );

    const newTable = screen.getByText('Miza 2').closest('div[style*="left: 235px"]');
    expect(newTable).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shrani spremembe' })).toBeEnabled();
  });
});