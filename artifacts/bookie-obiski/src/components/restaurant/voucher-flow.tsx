import React, { useState } from 'react';
import { useListJavniBoni, useCreateJavniBonCheckout } from '@workspace/api-client-react';
import type { JavnaRestavracija, JavniBonCheckoutInput } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Gift, Plus, Minus, ShoppingCart, ArrowLeft } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

interface VoucherFlowProps {
  restaurant: JavnaRestavracija;
}

type CartItem = {
  productId: string;
  variantId: string;
  quantity: number;
  priceCents: number;
  productName: string;
  variantName: string;
};

export function VoucherFlow({ restaurant }: VoucherFlowProps) {
  const { data: boni, isLoading } = useListJavniBoni(restaurant.slug);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  
  const [buyerIme, setBuyerIme] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  
  const createCheckout = useCreateJavniBonCheckout({
    mutation: {
      onSuccess: (data) => {
        // Stripe checkout returns checkoutUrl
        window.location.href = data.checkoutUrl;
      },
      onError: (err) => {
        toast.error('Napaka pri preusmeritvi', { description: 'Prosimo, poskusite znova kasneje.' });
      }
    }
  });

  const addToCart = (productId: string, productName: string, variantId: string, variantName: string, priceCents: number) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === productId && item.variantId === variantId);
      if (existing) {
        if (existing.quantity >= 20) return prev; // API limit max 20 per item
        return prev.map(item => 
          item.productId === productId && item.variantId === variantId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { productId, variantId, productName, variantName, priceCents, quantity: 1 }];
    });
    toast.success('Dodano v košarico');
  };

  const updateQuantity = (productId: string, variantId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId && item.variantId === variantId) {
        const newQ = item.quantity + delta;
        if (newQ < 1 || newQ > 20) return item;
        return { ...item, quantity: newQ };
      }
      return item;
    }));
  };

  const removeItem = (productId: string, variantId: string) => {
    setCart(prev => prev.filter(item => !(item.productId === productId && item.variantId === variantId)));
  };

  const totalCents = cart.reduce((acc, item) => acc + (item.priceCents * item.quantity), 0);

  const handleCheckout = (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0 || !buyerIme || !buyerEmail) return;

    const payload: JavniBonCheckoutInput = {
      idempotencyKey,
      items: cart.map(c => ({
        productId: c.productId,
        variantId: c.variantId,
        quantity: c.quantity
      })),
      buyerIme,
      buyerEmail,
      recipientIme: buyerIme,
      recipientEmail: buyerEmail,
      privacyAccepted: true
    };

    createCheckout.mutate({
      slug: restaurant.slug,
      data: payload
    });
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1,2].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />)}
      </div>
    );
  }

  if (!boni || boni.products.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <Gift className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-xl font-serif mb-2">Darilni boni trenutno niso na voljo</h3>
          <p className="text-muted-foreground">Poskusite ponovno kasneje.</p>
        </CardContent>
      </Card>
    );
  }

  // Never offer a purchase until the venue has its own ready Stripe account.
  // The server also enforces this at checkout; this is only the public-facing state.
  if (boni.checkoutEnabled !== true) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <Gift className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-xl font-serif mb-2">Spletni nakup bonov trenutno ni na voljo</h3>
          <p className="text-muted-foreground">Ta restavracija še nima omogočenih spletnih plačil. Za nakup bona se obrnite neposredno nanjo.</p>
        </CardContent>
      </Card>
    );
  }

  if (isCheckingOut) {
    return (
      <Card className="border-card-border shadow-sm p-6 md:p-8 fade-in">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-6">
              <Button variant="ghost" size="icon" onClick={() => setIsCheckingOut(false)} className="-ml-2">
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h2 className="text-2xl font-serif">Podatki kupca</h2>
            </div>
            
            <form id="checkout-form" onSubmit={handleCheckout} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="buyerName">Ime in priimek <span className="text-destructive">*</span></Label>
                <Input 
                  id="buyerName" 
                  value={buyerIme} 
                  onChange={e => setBuyerIme(e.target.value)} 
                  required 
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="buyerEmail">E-poštni naslov (sem prejmite bone) <span className="text-destructive">*</span></Label>
                <Input 
                  id="buyerEmail" 
                  type="email" 
                  value={buyerEmail} 
                  onChange={e => setBuyerEmail(e.target.value)} 
                  required 
                  className="h-12"
                />
              </div>
            </form>
          </div>
          
          <div className="w-full md:w-80 bg-muted/30 p-6 rounded-xl border border-border flex flex-col">
            <h3 className="font-serif text-lg mb-4 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" /> Povzetek
            </h3>
            <div className="space-y-3 mb-6 flex-1 overflow-y-auto pr-2">
              {cart.map(item => (
                <div key={`${item.productId}-${item.variantId}`} className="flex justify-between text-sm">
                  <div className="flex-1">
                    <div className="font-medium text-foreground leading-tight">{item.productName}</div>
                    <div className="text-muted-foreground text-xs">{item.variantName} &times; {item.quantity}</div>
                  </div>
                  <div className="font-medium text-right ml-2">
                    {formatCurrency(item.priceCents * item.quantity)}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="border-t border-border pt-4 mt-auto">
              <div className="flex justify-between font-serif text-lg mb-6">
                <span>Skupaj</span>
                <span>{formatCurrency(totalCents)}</span>
              </div>
              <Button 
                type="submit" 
                form="checkout-form"
                className="w-full h-12 text-lg"
                disabled={createCheckout.isPending || !buyerIme || !buyerEmail}
              >
                {createCheckout.isPending ? 'Nalagam...' : 'Nadaljuj na plačilo'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 fade-in">
      <div className="lg:col-span-2 space-y-6">
        {boni.products.filter(p => p.active).map(product => (
          <Card key={product.id} className="overflow-hidden border-card-border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex flex-col sm:flex-row">
              {product.imageUrl && (
                <div className="w-full sm:w-1/3 aspect-[4/3] sm:aspect-auto bg-muted">
                  <img src={product.imageUrl} alt={product.naziv} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-6 flex-1 flex flex-col">
                <h3 className="text-xl font-serif mb-2">{product.naziv}</h3>
                {product.opis && <p className="text-muted-foreground text-sm mb-6">{product.opis}</p>}
                
                <div className="mt-auto space-y-3">
                  {product.variants.map(variant => {
                    const cartItem = cart.find(c => c.productId === product.id && c.variantId === variant.id);
                    return (
                      <div key={variant.id} className="flex items-center justify-between border-t border-border pt-3 first:border-0 first:pt-0">
                        <div>
                          <div className="font-medium">{variant.naziv}</div>
                          <div className="text-primary font-serif">{formatCurrency(variant.amountCents, variant.currency)}</div>
                        </div>
                        
                        {cartItem ? (
                          <div className="flex items-center gap-3 bg-secondary/50 rounded-full px-2 py-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => updateQuantity(product.id, variant.id, -1)} disabled={cartItem.quantity <= 1}>
                              <Minus className="w-3 h-3" />
                            </Button>
                            <span className="font-medium w-4 text-center text-sm">{cartItem.quantity}</span>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => updateQuantity(product.id, variant.id, 1)} disabled={cartItem.quantity >= 20}>
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="rounded-full"
                            onClick={() => addToCart(product.id, product.naziv, variant.id, variant.naziv, variant.amountCents)}
                          >
                            Dodaj
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      
      {/* Sidebar Cart - Only visible on desktop if not empty, otherwise sticky bottom bar on mobile */}
      {cart.length > 0 && (
        <div className="lg:col-span-1">
          <div className="sticky top-6 bg-card border border-border shadow-sm rounded-xl p-6">
            <h3 className="font-serif text-xl mb-4 flex items-center gap-2 border-b border-border pb-4">
              <ShoppingCart className="w-5 h-5" /> Vaša košarica
            </h3>
            
            <div className="space-y-4 mb-6 max-h-[40vh] overflow-y-auto pr-2">
              {cart.map(item => (
                <div key={`${item.productId}-${item.variantId}`} className="flex justify-between text-sm group">
                  <div className="flex-1 pr-4">
                    <div className="font-medium text-foreground leading-tight">{item.productName}</div>
                    <div className="text-muted-foreground text-xs mb-1">{item.variantName}</div>
                    <button onClick={() => removeItem(item.productId, item.variantId)} className="text-xs text-destructive opacity-0 group-hover:opacity-100 transition-opacity">Odstrani</button>
                  </div>
                  <div className="text-right">
                    <div className="font-medium mb-1">{formatCurrency(item.priceCents * item.quantity)}</div>
                    <div className="text-xs text-muted-foreground">Količina: {item.quantity}</div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="border-t border-border pt-4">
              <div className="flex justify-between font-serif text-xl mb-6">
                <span>Skupaj</span>
                <span>{formatCurrency(totalCents)}</span>
              </div>
              <Button className="w-full h-12 text-lg" onClick={() => setIsCheckingOut(true)}>
                Na blagajno
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
