import { useState, useRef, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Mic, MicOff, Loader2, Send, AlertTriangle, CheckCircle2, RotateCcw, AlertCircle, Info } from "lucide-react";
import { useGlasovniUkaz, jePodprtGlasovniVnos } from "@/hooks/use-glasovni-ukaz";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useNaprava } from "@/contexts/NapravaContext";
import {
  getAuthToken,
  getGetNarociloQueryKey,
  getListAktivneIzmeneQueryKey,
  getListAktivnaNarocilaQueryKey,
  getListIzmeneQueryKey,
  getListNarocilaQueryKey,
} from "@workspace/api-client-react";
import { resolveAgentErrorMessage } from "@/lib/agent-error";
import { posFetch } from "@/lib/pos-auth-headers";
import { useToast } from "@/hooks/use-toast";
import {
  notifyPosActorSessionChanged,
} from "@/lib/pos-actor-session";
import {
  AGENT_OPEN_TABLE_EVENT,
  AGENT_OPEN_TABLE_STORAGE_KEY,
  parseAgentOpenTableNavigation,
  resolveSafeAgentStaticNavigation,
} from "@/lib/agent-table-navigation";
import { NormativeComparisonProposals } from "@/components/NormativeComparisonProposals";

interface AgentAction {
  tip: string;
  opis: string;
}

export interface AgentMemoryItem {
  role: "user" | "agent";
  content: string;
  actions?: AgentAction[];
  warnings?: string[];
  suggestions?: string[];
  comparison?: NormativeComparison;
  courseClarification?: CourseClarification;
}

export interface CourseClarification {
  token: string;
  options: Array<{ courseNumber: number; courseName: string }>;
}

export interface NormativeComparison {
  generatedAt: string;
  localNormative: { artikelId: number; targetName: string; rows: Array<{ ingredientId: number; ingredientName: string; quantity: number; unit: string | null }> };
  rows: Array<{ normativRowId: number; ingredientId: number; ingredientName: string; localQuantity: number; localUnit: string | null; externalQuantity: number | null; externalUnit: string | null; servings: number | null; sourceUrl: string | null; sourceTitle: string | null; proposalToken: string | null; localNormalizedQuantity: number | null; externalNormalizedQuantity: number | null; comparisonUnit: string | null; status: "comparable" | "missing" | "incomparable"; difference: number | null; percentDifference: number | null }>;
  sources: Array<{ url: string; title: string; checkedAt: string; pageDate: string | null }>;
  warnings: string[];
  disclaimer: string;
}

export function isSafeComparisonLink(url: string): boolean {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

export interface AgentResponse {
  odgovor: string;
  action: "explain" | "navigate" | "open_own_shift" | "add_item" | "update_item" | "remove_item" | "move_order" | "merge_order" | "prepare_checkout" | "assign_course" | "assign_courses" | "compare_normative";
  navigateTo?: string;
  narociloId?: number;
  artikelId?: number;
  postavkaId?: number;
  kolicina?: number;
  opomba?: string | null;
  gostStevilka?: number | null;
  mizaId?: number;
  virNarociloId?: number;
  missingPrerequisites?: string[];
  clarifications?: string[];
  courseClarification?: CourseClarification;
  courseNumber?: number;
  pairingGroupId?: string;
  changed?: boolean;
  comparison?: NormativeComparison;
}

export function isAgentOrderMutationAction(action: AgentResponse["action"]): boolean {
  return ["add_item", "update_item", "remove_item", "move_order", "merge_order", "assign_course", "assign_courses"].includes(action);
}

export function isAgentCourseMutationAction(action: AgentResponse["action"]): boolean {
  return action === "assign_course" || action === "assign_courses";
}

export function CourseClarificationChoices(props: {
  clarification: CourseClarification;
  currentToken: string | null;
  loading: boolean;
  onSelect: (courseNumber: number) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 max-w-[85%]" aria-label="Izbira hoda">
      {props.clarification.options.map(option => (
        <Button
          key={`${option.courseNumber}:${option.courseName}`}
          variant="outline"
          size="sm"
          className="h-auto py-2 px-3 text-xs bg-background hover:bg-muted text-primary hover:text-primary/90 border-primary/20"
          onClick={() => props.onSelect(option.courseNumber)}
          disabled={props.loading || props.currentToken !== props.clarification.token}
        >
          {option.courseName} ({option.courseNumber})
        </Button>
      ))}
    </div>
  );
}

export function AgentLauncher() {
  const [isOpen, setIsOpen] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<AgentMemoryItem[]>([]);
  const [pendingCourseClarification, setPendingCourseClarification] = useState<CourseClarification | null>(null);
  const transcriptRef = useRef<string>("");
  const submitTranscriptRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { poslusam, zacni: zacniPoslusanje, ustavi: ustaviPoslusanje } = useGlasovniUkaz();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { naprava, napravaKljuc } = useNaprava();

  useEffect(() => {
    setPendingCourseClarification(null);
  }, [location, user?.enotaId]);

  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [history, loading, poslusam, errorMsg]);

  useEffect(() => {
    if (!isOpen || !naprava?.aiAccessToken || history.length > 0) return;
    const actorSession = sessionStorage.getItem("pos_actor_session");
    if (!actorSession) return;
    const loadHistory = async () => {
      try {
        const token = await getAuthToken();
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const response = await fetch(`${base}/api/ai/agent/history`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(user?.enotaId ? { "X-Enota-Id": String(user.enotaId) } : {}),
            "X-Naprava-Id": napravaKljuc,
            "X-AI-Device-Token": naprava.aiAccessToken!,
            "X-Pos-Actor-Session": actorSession,
          },
        });
        if (!response.ok) return;
        const saved = await response.json() as {
          history?: Array<{ action: string; outcome: string }>;
          memory?: Array<{ preferenceKey: string; preferenceValue: string }>;
        };
        const messages: AgentMemoryItem[] = [];
        if (saved.memory?.length) {
          messages.push({
            role: "agent",
            content: `Pomnim vaše delovne preference: ${saved.memory
              .map((item) => `${item.preferenceKey} = ${item.preferenceValue}`).join(", ")}.`,
          });
        }
        const recent = saved.history?.slice(0, 5) ?? [];
        if (recent.length) {
          messages.push({
            role: "agent",
            content: `Zadnja zabeležena dejanja: ${recent
              .map((item) => `${item.action} (${item.outcome})`).join(", ")}.`,
          });
        }
        if (messages.length) setHistory(messages);
      } catch {
        // Pogovor ostane uporaben tudi, če zgodovine trenutno ni mogoče naložiti.
      }
    };
    void loadHistory();
  }, [history.length, isOpen, naprava?.aiAccessToken, napravaKljuc, user?.enotaId]);

  const handleSend = async (question: string) => {
    if (!question.trim()) return;
    const isClarificationReply = /^(?:hod\s*)?\d{1,2}$/iu.test(question.trim());
    const courseClarificationToken = isClarificationReply ? pendingCourseClarification?.token : undefined;
    
    const userMsg: AgentMemoryItem = { role: "user", content: question };
    setHistory((prev) => [...prev, userMsg]);
    setTextInput("");
    setLoading(true);
    setErrorMsg(null);

    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const url = `${base}/api/ai/agent`;
      const token = await getAuthToken();
      const actorSession = sessionStorage.getItem("pos_actor_session");
      if (!actorSession) {
        setIsOpen(false);
        notifyPosActorSessionChanged();
        throw new Error(resolveAgentErrorMessage(401));
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (user?.enotaId) headers["X-Enota-Id"] = String(user.enotaId);
      if (napravaKljuc) headers["X-Naprava-Id"] = napravaKljuc;
      if (naprava?.aiAccessToken) headers["X-AI-Device-Token"] = naprava.aiAccessToken;
      headers["X-Pos-Actor-Session"] = actorSession;

      let orderId: string | undefined;
      const narociloMatch = location.match(/^\/narocilo\/(\d+)/);
      if (narociloMatch) {
        orderId = narociloMatch[1];
      }

      const body = {
        pot: location,
        narociloId: orderId ? Number(orderId) : undefined,
        ukaz: question,
        ...(courseClarificationToken ? { courseClarificationToken } : {}),
      };

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { napaka?: string; error?: string } | null;
        if (response.status === 401) {
          setPendingCourseClarification(null);
          sessionStorage.removeItem("pos_actor_session");
          setIsOpen(false);
          notifyPosActorSessionChanged();
        }
        throw new Error(resolveAgentErrorMessage(response.status, payload));
      }

      const data = (await response.json()) as AgentResponse;
      if (data.courseClarification) {
        setPendingCourseClarification(data.courseClarification);
      } else if (courseClarificationToken) {
        setPendingCourseClarification(null);
      }

      if (data.action === "open_own_shift") {
        const shiftResponse = await posFetch(`${base}/api/izmene`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mojaIzmena: true,
            blagajnaId: user?.blagajnaId ?? null,
          }),
        });
        if (!shiftResponse.ok) {
          const payload = await shiftResponse.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? resolveAgentErrorMessage(shiftResponse.status));
        }
        data.odgovor = "Vaša izmena je odprta.";
        setIsOpen(false);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListAktivneIzmeneQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListIzmeneQueryKey() }),
        ]);
        toast({
          title: "Izmena odprta",
          description: "Vaša izmena je bila uspešno odprta.",
        });
      }
      if (data.action === "add_item" && data.narociloId && data.artikelId) {
        const mutation = await posFetch(`${base}/api/narocila/${data.narociloId}/postavke`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artikelId: data.artikelId, kolicina: data.kolicina ?? 1 }),
        });
        if (!mutation.ok) throw new Error((await mutation.json().catch(() => null) as { error?: string; napaka?: string } | null)?.error ?? "Artikla ni bilo mogoče dodati.");
      }
      if (data.action === "update_item" && data.narociloId && data.postavkaId) {
        const mutation = await posFetch(`${base}/api/narocila/${data.narociloId}/postavke/${data.postavkaId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(data.kolicina !== undefined ? { kolicina: data.kolicina } : {}),
            ...(data.opomba !== undefined ? { opomba: data.opomba } : {}),
            ...(data.gostStevilka !== undefined ? { gostStevilka: data.gostStevilka } : {}),
          }),
        });
        if (!mutation.ok) throw new Error((await mutation.json().catch(() => null) as { error?: string; napaka?: string } | null)?.error ?? "Postavke ni bilo mogoče posodobiti.");
      }
      if (data.action === "remove_item" && data.narociloId && data.postavkaId) {
        const mutation = await posFetch(`${base}/api/narocila/${data.narociloId}/postavke/${data.postavkaId}`, { method: "DELETE" });
        if (!mutation.ok) throw new Error((await mutation.json().catch(() => null) as { error?: string; napaka?: string } | null)?.error ?? "Postavke ni bilo mogoče odstraniti.");
      }
      if (data.action === "move_order" && data.narociloId && data.mizaId) {
        const mutation = await posFetch(`${base}/api/narocila/${data.narociloId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mizaId: data.mizaId }),
        });
        if (!mutation.ok) throw new Error((await mutation.json().catch(() => null) as { error?: string; napaka?: string } | null)?.error ?? "Naročila ni bilo mogoče premakniti.");
      }
      if (data.action === "merge_order" && data.narociloId && data.virNarociloId) {
        const mutation = await posFetch(`${base}/api/narocila/${data.narociloId}/spoji`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ virNarociloId: data.virNarociloId }),
        });
        if (!mutation.ok) throw new Error((await mutation.json().catch(() => null) as { error?: string; napaka?: string } | null)?.error ?? "Naročil ni bilo mogoče združiti.");
      }
      if (isAgentOrderMutationAction(data.action)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListNarocilaQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() }),
          ...(data.narociloId ? [queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(data.narociloId) })] : []),
          ...(isAgentCourseMutationAction(data.action) ? [queryClient.invalidateQueries({ queryKey: ["kds"] })] : []),
        ]);
      }
      
      const agentMsg: AgentMemoryItem = {
        role: "agent",
        content: data.odgovor || "Naloga izvedena.",
        actions: isAgentOrderMutationAction(data.action)
          ? [{ tip: "Izvedeno", opis: data.odgovor }]
          : undefined,
        warnings: data.action === "prepare_checkout" && data.missingPrerequisites?.length
          ? data.missingPrerequisites
          : data.comparison?.warnings,
        comparison: data.action === "compare_normative" ? data.comparison : undefined,
        courseClarification: data.courseClarification,
      };

      setHistory((prev) => [...prev, agentMsg]);
      
      if (data.navigateTo) {
        setIsOpen(false);
        const tableNumber = parseAgentOpenTableNavigation(data.navigateTo);
        if (tableNumber !== null) {
          sessionStorage.setItem(AGENT_OPEN_TABLE_STORAGE_KEY, String(tableNumber));
          setLocation("/");
          window.dispatchEvent(new Event(AGENT_OPEN_TABLE_EVENT));
        } else {
          const safePath = data.action === "prepare_checkout"
            ? data.navigateTo
            : resolveSafeAgentStaticNavigation(data.navigateTo);
          if (!safePath) throw new Error("AI je predlagal neveljavno ali neobstoječo pot.");
          setLocation(safePath);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Neznana napaka pri komunikaciji z agentom.";
      setErrorMsg(null);
      setHistory((prev) => [...prev, { 
        role: "agent", 
        content: message,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceClick = () => {
    if (loading) return;
    if (poslusam) {
      ustaviPoslusanje();
      return;
    }

    setErrorMsg(null);
    transcriptRef.current = "";
    submitTranscriptRef.current = true;

    zacniPoslusanje({
      onResult: (tekst) => {
        const segment = tekst.trim();
        if (segment && !transcriptRef.current.endsWith(segment)) {
          transcriptRef.current = `${transcriptRef.current} ${segment}`.trim();
        }
      },
      onError: (napaka) => {
        submitTranscriptRef.current = false;
        setErrorMsg(napaka || "Napaka pri prepoznavanju govora.");
      },
      onEnd: () => {
        if (submitTranscriptRef.current && transcriptRef.current.trim()) {
          handleSend(transcriptRef.current);
        }
        submitTranscriptRef.current = false;
        transcriptRef.current = "";
      }
    }, 0, { continuous: true });
  };

  const resetSession = async () => {
    setHistory([]);
    setPendingCourseClarification(null);
    setTextInput("");
    setErrorMsg(null);
    if (poslusam) ustaviPoslusanje();
    if (!naprava?.aiAccessToken) return;
    try {
      const token = await getAuthToken();
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/ai/agent/memory`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(user?.enotaId ? { "X-Enota-Id": String(user.enotaId) } : {}),
          "X-Naprava-Id": napravaKljuc,
          "X-AI-Device-Token": naprava.aiAccessToken,
          ...(sessionStorage.getItem("pos_actor_session")
            ? { "X-Pos-Actor-Session": sessionStorage.getItem("pos_actor_session")! }
            : {}),
        },
      });
      if (!res.ok) {
        throw new Error(`Napaka ${res.status}`);
      }
    } catch {
      setErrorMsg("Spomina na strežniku ni bilo mogoče ponastaviti.");
    }
  };

  const isSupported = jePodprtGlasovniVnos();

  if (!naprava?.terminalConfig?.aiSvetovalecAktiven) return null;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button 
          size="icon" 
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] right-4 md:bottom-6 md:right-6 h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground z-50 transition-transform active:scale-95"
        >
          <Bot className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      
      <SheetContent
        className="w-full sm:max-w-md flex flex-col p-0 border-l shadow-2xl z-[100] bg-background [&>button]:right-3 [&>button]:top-3 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-lg [&>button_svg]:h-6 [&>button_svg]:w-6"
        side="right"
      >
        <SheetHeader className="p-4 pr-16 border-b shrink-0 flex flex-row items-center justify-between bg-muted/40">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary p-2 rounded-xl">
              <Bot className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <SheetTitle className="text-sm font-semibold leading-none text-left">Pomočnik</SheetTitle>
              <SheetDescription className="text-xs mt-1 text-left">
                Upravljanje prodajnega mesta
              </SheetDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={resetSession} title="Ponastavi pogovor" className="text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4 py-4" ref={scrollRef}>
          <div className="space-y-5 pb-4">
            {history.length === 0 && !loading && !poslusam && (
              <div className="flex flex-col items-center justify-center text-center text-muted-foreground mt-12 space-y-3">
                <Info className="h-8 w-8 text-primary/20" />
                <div className="text-sm max-w-[250px]">
                  Pomočnik je pripravljen.<br />
                  Vprašajte o artiklih ali preverite stanje POS-a.
                  <span className="mt-2 block text-xs">
                    Splošna vprašanja se po lokalni odstranitvi očitnih kontaktnih podatkov obdelajo pri nastavljenem ponudniku AI in se ne shranjujejo v surovi obliki. Samodejna prepoznava ni popolna.
                  </span>
                </div>
              </div>
            )}

            {history.map((msg, i) => (
              <div key={i} className={`flex flex-col w-full ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`p-3 rounded-2xl text-[14px] leading-relaxed max-w-[85%] ${
                  msg.role === "user" 
                    ? "bg-primary text-primary-foreground rounded-tr-sm shadow-sm" 
                    : "bg-muted text-foreground rounded-tl-sm border border-border"
                }`}>
                  {msg.content}
                </div>
                
                {msg.warnings && msg.warnings.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5 w-full max-w-[85%]">
                    {msg.warnings.map((w, j) => (
                      <div key={j} className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 p-2.5 rounded-xl border border-amber-200 shadow-sm">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                        <span className="leading-snug">{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {msg.comparison && (
                  <section className="mt-2 w-full max-w-[85%] rounded-xl border border-border bg-background p-2.5 text-xs" aria-label={`Primerjava normativa za ${msg.comparison.localNormative.targetName}`}>
                    <p className="font-semibold">Normativ: {msg.comparison.localNormative.targetName}</p>
                    <p className="text-muted-foreground">Pripravljeno: {new Date(msg.comparison.generatedAt).toLocaleDateString("sl-SI")}</p>
                    <NormativeComparisonProposals comparison={msg.comparison} onReview={() => { setIsOpen(false); setLocation("/meni"); }} />
                    <p className="mt-2 text-muted-foreground">{msg.comparison.disclaimer}</p>
                    {msg.comparison.sources.length > 0 && <div className="mt-2 flex flex-col gap-1" aria-label="Viri primerjave">
                      {msg.comparison.sources.filter(source => isSafeComparisonLink(source.url)).map(source => (
                        <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all" aria-label={`Odpri vir: ${source.title}`}>
                          {source.title} <span className="text-muted-foreground">({source.pageDate ?? source.checkedAt.slice(0, 10)})</span>
                        </a>
                      ))}
                    </div>}
                  </section>
                )}
                
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5 w-full max-w-[85%]">
                    {msg.actions.map((act, j) => (
                      <div key={j} className="flex items-start gap-2 text-xs text-emerald-900 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 shadow-sm">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="leading-snug">
                          <span className="font-semibold text-emerald-800">{act.tip}: </span>
                          {act.opis}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {msg.suggestions && msg.suggestions.length > 0 && msg.role === "agent" && (
                  <div className="mt-2 flex flex-wrap gap-1.5 max-w-[85%]">
                    {msg.suggestions.map((sug, j) => (
                      <Button 
                        key={j} 
                        variant="outline" 
                        size="sm" 
                        className="h-auto py-1.5 px-3 text-xs bg-background hover:bg-muted text-primary hover:text-primary/90 border-primary/20" 
                        onClick={() => handleSend(sug)}
                      >
                        {sug}
                      </Button>
                    ))}
                  </div>
                )}

                {msg.courseClarification && msg.role === "agent" && (
                  <CourseClarificationChoices
                    clarification={msg.courseClarification}
                    currentToken={pendingCourseClarification?.token ?? null}
                    loading={loading}
                    onSelect={courseNumber => handleSend(String(courseNumber))}
                  />
                )}
              </div>
            ))}

            {poslusam && (
              <div className="flex flex-col items-start w-full">
                <div className="p-3 rounded-2xl text-[14px] bg-primary/5 border border-primary/20 text-primary rounded-tl-sm flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/40 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                  </span>
                  <span className="font-medium">Poslušam...</span>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-start w-full">
                <div className="p-3 rounded-2xl text-[14px] bg-muted rounded-tl-sm border border-border flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground font-medium">Obdelujem...</span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-xl border border-destructive/20 mt-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1 font-medium">{errorMsg}</span>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t bg-background shrink-0">
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(textInput); }}
            className="flex items-center gap-2 relative"
          >
            {isSupported && (
              <Button 
                type="button" 
                variant={poslusam ? "destructive" : "secondary"}
                size="icon"
                className="shrink-0 h-12 w-12 rounded-xl transition-colors select-none"
                aria-label={poslusam ? "Ustavi in pošlji" : "Začni govor"}
                title={poslusam ? "Ustavi in pošlji" : "Začni govor"}
                onClick={handleVoiceClick}
                disabled={loading}
              >
                {poslusam ? <MicOff className="h-5 w-5 pointer-events-none" /> : <Mic className="h-5 w-5 pointer-events-none" />}
              </Button>
            )}
            
            <Input 
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Vpišite ukaz..."
              disabled={loading || poslusam}
              className="flex-1 h-12 rounded-xl bg-muted border-transparent focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
            />
            
            <Button 
              type="submit" 
              size="icon" 
              disabled={!textInput.trim() || loading || poslusam}
              className="shrink-0 h-12 w-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Send className="h-5 w-5" />
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
