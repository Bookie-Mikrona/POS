import React, { useState } from "react";
import { Loader2, RefreshCw, Send, AlertTriangle, Info, Bot, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { type AiSvetovalecResponse } from "@/hooks/use-ai-svetovalec";

interface AiSvetovalecPanelProps {
  loading: boolean;
  data: AiSvetovalecResponse | null;
  error: string | null;
  onRefresh: (vprasanje?: string) => void;
  className?: string;
  isBlagajna?: boolean;
}

export function AiSvetovalecPanel({ loading, data, error, onRefresh, className = "", isBlagajna = false }: AiSvetovalecPanelProps) {
  const [vprasanje, setVprasanje] = useState("");
  const [expanded, setExpanded] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vprasanje.trim() || loading) return;
    onRefresh(vprasanje.trim());
    setVprasanje("");
  };

  if (!data && !loading && !error) return null;

  return (
    <Card className={`border-l-4 overflow-hidden transition-all duration-300 ${data?.blokirano && isBlagajna ? "border-l-destructive bg-destructive/5" : "border-l-primary/60 shadow-sm"} ${className}`}>
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between space-y-0 cursor-pointer select-none bg-muted/20" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          <Bot className={`h-4 w-4 ${data?.blokirano && isBlagajna ? "text-destructive" : "text-primary"}`} />
          <CardTitle className="text-sm font-semibold">AI Svetovalec</CardTitle>
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
        </div>
        <div className="flex items-center gap-1">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6" 
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            disabled={loading}
            title="Osveži analizo"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <div className="h-6 w-6 flex items-center justify-center text-muted-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>
      
      {expanded && (
        <>
          <CardContent className="p-3 pt-2 text-sm space-y-3">
            {error && (
              <div className="flex items-start gap-2 text-destructive bg-destructive/10 p-2 rounded-md">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="text-xs leading-tight">{error}</span>
              </div>
            )}
            
            {data?.kriticneNapake && data.kriticneNapake.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Opozorila</span>
                </div>
                <ul className="space-y-1">
                  {data.kriticneNapake.map((napaka, i) => (
                    <li key={i} className="text-xs text-destructive/90 bg-destructive/10 px-2 py-1.5 rounded-md leading-tight border border-destructive/20">
                      {napaka}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data?.povzetek && (
              <div className="text-xs text-foreground/80 leading-relaxed border-l-2 border-primary/30 pl-2">
                {data.povzetek}
              </div>
            )}

            {data?.nasveti && data.nasveti.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-foreground/80 text-xs uppercase tracking-wider">
                  <Info className="h-3.5 w-3.5" />
                  <span>Priporočila</span>
                </div>
                <ul className="space-y-1">
                  {data.nasveti.map((nasvet, i) => (
                    <li key={i} className="text-xs text-muted-foreground bg-muted/40 px-2 py-1.5 rounded-md leading-tight">
                      {nasvet}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>

          <CardFooter className="p-2 pt-0 bg-muted/10 border-t">
            <form onSubmit={handleSubmit} className="flex w-full gap-1.5">
              <Input
                type="text"
                placeholder="Vprašajte svetovalca..."
                value={vprasanje}
                onChange={(e) => setVprasanje(e.target.value)}
                className="h-8 text-xs bg-background"
                disabled={loading}
              />
              <Button type="submit" size="icon" disabled={!vprasanje.trim() || loading} className="h-8 w-8 shrink-0">
                <Send className="h-3 w-3" />
              </Button>
            </form>
          </CardFooter>
        </>
      )}
    </Card>
  );
}