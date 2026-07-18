import React from "react";
import { AlertCircle, Wrench, ArrowLeft } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";

interface PlaceholderProps {
  title: string;
  description: string;
}

export default function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto px-4">
      <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground mb-6 shadow-sm border border-border/50">
        <Wrench className="h-8 w-8" />
      </div>
      
      <h1 className="text-2xl font-bold tracking-tight mb-2">{title}</h1>
      <p className="text-muted-foreground mb-8">
        {description}
      </p>
      
      <div className="bg-muted/50 border border-border rounded-lg p-4 text-sm text-left w-full mb-8">
        <div className="flex items-center gap-2 text-primary font-medium mb-2">
          <AlertCircle className="h-4 w-4" />
          <span>Status modula</span>
        </div>
        <p className="text-muted-foreground">
          Ta modul je trenutno v fazi razvoja. Arhitektura baze in API vmesniki se pripravljajo in bodo na voljo v naslednji različici.
        </p>
      </div>
      
      <Button asChild variant="outline">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Nazaj na nadzorno ploščo
        </Link>
      </Button>
    </div>
  );
}