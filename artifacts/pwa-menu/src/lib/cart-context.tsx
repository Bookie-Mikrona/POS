import React, { createContext, useContext, useState, ReactNode } from 'react';
import { type PublicMenuArticle } from '@/hooks/use-public-api';

export type CartItemModifier = {
  modifikatorId: number;
  ime: string;
  cenaDodatek: number;
};

export type CartItem = {
  id: string; // unique local ID (uuid or timestamp)
  artikel: PublicMenuArticle;
  kolicina: number;
  modifikatorji: CartItemModifier[];
  opomba?: string;
  velikostPice?: "mala" | "normalna" | "druzinska";
  toGo?: boolean;
  multicourseSelection?: {
    menuArtikelId: number;
    courses: Array<{ courseNumber: number; courseName: string; foodArtikelId: number; wineArtikelId: number | null }>;
    informationalCourseNames?: string[];
  };
};

export function cenaArtiklaVKosarici(item: Pick<CartItem, "artikel" | "velikostPice">): number {
  if (!item.velikostPice) return item.artikel.cena;
  return item.artikel.velikostiPic.find((velikost) => velikost.id === item.velikostPice)?.cena ?? item.artikel.cena;
}

export function cenaToGoEmbalazeVKosarici(item: Pick<CartItem, "artikel" | "toGo" | "kolicina">): number {
  if (!item.toGo) return 0;
  return (item.artikel.toGoEmbalaza ?? []).reduce((sum, embalaza) => sum + embalaza.cena * item.kolicina, 0);
}

type CartContextType = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'id'>) => void;
  updateQuantity: (id: string, kolicina: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  cartTotal: number;
  cartCount: number;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = (item: Omit<CartItem, 'id'>) => {
    setItems((currentItems) => {
      // Združimo samo popolnoma enake vrstice; opombe in modifikatorji ostanejo ločeni.
      const existingIndex = currentItems.findIndex(
        (i) =>
          i.artikel.id === item.artikel.id &&
          i.opomba === item.opomba &&
           i.velikostPice === item.velikostPice &&
           Boolean(i.toGo) === Boolean(item.toGo) &&
           JSON.stringify(i.multicourseSelection) === JSON.stringify(item.multicourseSelection) &&
          JSON.stringify(i.modifikatorji.map(m => m.modifikatorId).sort()) ===
          JSON.stringify(item.modifikatorji.map(m => m.modifikatorId).sort())
      );

      if (existingIndex >= 0) {
        return currentItems.map((current, index) =>
          index === existingIndex
            ? { ...current, kolicina: current.kolicina + item.kolicina }
            : current,
        );
      }
      return [...currentItems, { ...item, id: Math.random().toString(36).slice(2, 9) }];
    });
  };

  const updateQuantity = (id: string, kolicina: number) => {
    if (kolicina <= 0) {
      removeItem(id);
      return;
    }
    setItems((currentItems) => currentItems.map((i) => (i.id === id ? { ...i, kolicina } : i)));
  };

  const removeItem = (id: string) => {
    setItems((currentItems) => currentItems.filter((i) => i.id !== id));
  };

  const clearCart = () => setItems([]);

  const cartTotal = items.reduce((sum, item) => {
    const modsTotal = item.modifikatorji.reduce((mSum, m) => mSum + m.cenaDodatek, 0);
    return sum + (cenaArtiklaVKosarici(item) + modsTotal) * item.kolicina + cenaToGoEmbalazeVKosarici(item);
  }, 0);

  const cartCount = items.reduce((count, item) => count + item.kolicina, 0);

  return (
    <CartContext.Provider value={{ items, addItem, updateQuantity, removeItem, clearCart, cartTotal, cartCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
