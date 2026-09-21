import React from 'react';
import { AlertCircle } from 'lucide-react';

export default function MissingTokenPage() {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center p-6 text-center bg-background" data-testid="page-missing-token">
      <img
        src={`${import.meta.env.BASE_URL}mikrona-logo.png`}
        alt="Mikrona d.o.o."
        className="h-16 w-16 object-contain mb-4"
      />
      <p className="text-xs font-semibold text-muted-foreground mb-6">Mikrona d.o.o.</p>
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
        <AlertCircle className="w-8 h-8 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-display font-semibold mb-3">Neveljavna povezava</h1>
      <p className="text-muted-foreground text-lg max-w-sm">
        Skenirajte QR kodo na mizi za dostop do menija.
      </p>
    </div>
  );
}
