import React, { useState, useRef, useEffect } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Send, Sparkles, Clock, History, Trash2, Info } from 'lucide-react';
import { useAskPublicMenuAi, useGetPublicMenuDeviceHistory, getGetPublicMenuDeviceHistoryQueryKey } from '@workspace/api-client-react';
import { useHistoryOptIn } from '@/hooks/use-history-opt-in';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: string[];
  freshness?: string;
  loading?: boolean;
};

type GuestAssistantDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  qrNapravaId: string;
  activated: boolean;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
};

const SUGGESTIONS = [
  "Katera vina so na voljo?",
  "Koliko stane pica Margerita?",
  "Imate cigarete na zalogi?",
  "Katere pice se trenutno pripravljajo?",
  "Kakšna je čakalna doba?"
];

export function GuestAssistantDrawer({ open, onOpenChange, token, qrNapravaId, activated, messages, setMessages }: GuestAssistantDrawerProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { optedIn, setOptIn } = useHistoryOptIn();

  const historyQuery = useGetPublicMenuDeviceHistory(
    token,
    { qrNapravaId, historyOptIn: optedIn },
    {
      query: {
        enabled: open && optedIn && !!token && !!qrNapravaId && activated,
        queryKey: getGetPublicMenuDeviceHistoryQueryKey(token, { qrNapravaId, historyOptIn: optedIn })
      },
      request: { credentials: 'include' }
    }
  );

  const askAi = useAskPublicMenuAi({ request: { credentials: 'include' } });

  // Scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      const viewport = el.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages, open]);

  const handleSubmit = (text: string = input) => {
    if (!text.trim() || askAi.isPending) return;

    const userMsgId = Date.now().toString();
    const tempAsstId = (Date.now() + 1).toString();

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', text: text.trim() },
      { id: tempAsstId, role: 'assistant', text: '', loading: true }
    ]);

    setInput("");

    askAi.mutate({
      token,
      data: {
        qrNapravaId,
        question: text.trim(),
        historyOptIn: optedIn
      }
    }, {
      onSuccess: (data) => {
        setMessages(prev => prev.map(msg =>
          msg.id === tempAsstId
            ? { ...msg, text: data.answer, loading: false, sources: data.sources, freshness: data.freshness }
            : msg
        ));
      },
      onError: (err) => {
        setMessages(prev => prev.map(msg =>
          msg.id === tempAsstId
            ? { ...msg, text: "Oprostite, prišlo je do napake pri iskanju odgovora.", loading: false }
            : msg
        ));
      }
    });
  };

  const clearHistory = () => {
    setOptIn(false);
    setMessages([]);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[90dvh] flex flex-col sm:max-w-md sm:mx-auto outline-none">
        <DrawerHeader className="border-b px-4 py-3 shrink-0 flex items-center justify-between">
          <div className="flex flex-col gap-1 text-left">
            <DrawerTitle className="flex items-center gap-2 font-display text-lg">
              <Sparkles className="w-5 h-5 text-emerald-500" />
              Pomočnik in priporočila
            </DrawerTitle>
            <DrawerDescription className="text-xs">
              Vprašajte me karkoli o meniju ali zalogi.
            </DrawerDescription>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" onClick={() => setMessages([])} className="shrink-0 h-8 w-8 text-muted-foreground rounded-full hover:bg-secondary" data-testid="button-clear-chat">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </DrawerHeader>

        <ScrollArea ref={scrollRef} className="flex-1 px-4 py-4 w-full bg-secondary/30">
          <div className="space-y-6 max-w-full pb-4">

            {/* History Opt-In / View Area */}
            {!optedIn ? (
              <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm space-y-3" data-testid="history-opt-in-banner">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <History className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Prilagojena priporočila</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Dovolite shranjevanje zgodovine naročil na tej napravi (brskalniku), da vam lahko pomočnik svetuje na podlagi vašega okusa.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full rounded-xl"
                  onClick={() => setOptIn(true)}
                  data-testid="button-opt-in"
                >
                  Vklopi zgodovino
                </Button>
              </div>
            ) : (
              <div className="space-y-3" data-testid="history-view">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <History className="w-4 h-4 text-muted-foreground" />
                    Vaša pretekla naročila
                  </h3>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground px-2" onClick={clearHistory} data-testid="button-opt-out">
                    Izklopi & Počisti
                  </Button>
                </div>

                {historyQuery.isLoading && (
                  <div className="h-20 flex items-center justify-center bg-card rounded-2xl border border-border/50" data-testid="history-loading">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {historyQuery.isError && (
                  <div className="p-4 bg-destructive/10 text-destructive text-xs rounded-2xl border border-destructive/20 text-center" data-testid="history-error">
                    Zgodovine trenutno ni mogoče naložiti.
                  </div>
                )}

                {historyQuery.data && historyQuery.data.orders.length === 0 && (
                  <div className="p-4 bg-card text-muted-foreground text-xs rounded-2xl border border-border/50 text-center" data-testid="history-empty">
                    Na tej napravi še ni preteklih naročil.
                  </div>
                )}

                {historyQuery.data && historyQuery.data.orders.length > 0 && (
                  <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory hide-scrollbar -mx-4 px-4" data-testid="history-list">
                    {historyQuery.data.orders.map(order => (
                      <div key={order.orderId} className="shrink-0 w-[240px] snap-center bg-card border border-border/50 p-3 rounded-2xl shadow-xs flex flex-col">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            {new Date(order.createdAt).toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' })}
                          </span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                            order.status === 'zakljuceno' ? 'bg-emerald-500/10 text-emerald-700' :
                            order.status === 'odprto' ? 'bg-amber-500/10 text-amber-700' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {order.status}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {order.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between text-xs">
                              <span className="truncate pr-2 font-medium">{item.name}</span>
                              <span className="text-muted-foreground whitespace-nowrap">{item.quantity}x</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Chat Messages */}
            <div className="space-y-4 pt-2">
              {messages.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8 px-4" data-testid="chat-empty">
                  Zastavite mi vprašanje in pomagal vam bom z informacijami v živo.
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`} data-testid={`chat-message-${msg.role}`}>
                  <div
                    className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-card border border-border/50 text-card-foreground shadow-sm rounded-tl-sm'
                    }`}
                  >
                    {msg.loading ? (
                      <div className="flex items-center gap-2 text-muted-foreground h-5" data-testid="chat-loading">
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                    )}
                  </div>

                  {msg.role === 'assistant' && !msg.loading && (msg.sources || msg.freshness) && (
                    <div className="flex items-center gap-2 mt-1.5 pl-1">
                      {msg.freshness && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium" data-testid="chat-freshness">
                          <Clock className="w-3 h-3" />
                          <span>{msg.freshness}</span>
                        </div>
                      )}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium" data-testid="chat-sources">
                          <Info className="w-3 h-3" />
                          <span className="truncate max-w-[150px]">Vir: {msg.sources.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>

        <div className="shrink-0 bg-background border-t p-3 pb-6 sm:pb-4 space-y-3">
          <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1 -mx-3 px-3 snap-x">
            {SUGGESTIONS.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSubmit(suggestion)}
                className="shrink-0 snap-start bg-secondary text-secondary-foreground text-xs px-3 py-1.5 rounded-full whitespace-nowrap hover:bg-secondary/80 font-medium transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
            className="flex gap-2 items-center"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Vprašajte o meniju..."
              className="flex-1 h-12 bg-secondary/50 border-0 rounded-xl px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              disabled={askAi.isPending}
            />
            <Button
              type="submit"
              size="icon"
              className="h-12 w-12 rounded-xl shrink-0 shadow-sm"
              disabled={!input.trim() || askAi.isPending}
            >
              {askAi.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
