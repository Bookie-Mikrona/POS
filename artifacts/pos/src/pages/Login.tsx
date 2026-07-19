import { useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { Uporabnik } from "@/contexts/AuthContext";
import { getAndClearReturnUrl } from "@/lib/returnUrl";

const SUPERADMIN_PREFIX = "/superadmin";

function isSuperadminPath(url: string): boolean {
  return url === SUPERADMIN_PREFIX || url.startsWith(SUPERADMIN_PREFIX + "/");
}

function getSafeReturnUrl(url: string | null, vloga?: string): string {
  if (!url) return "/";
  if (!url.startsWith("/")) return "/";
  if (url.startsWith("//")) return "/";
  if (url === "/login") return "/";
  // Superadmin sme samo na /superadmin/* poteh
  if (vloga === "superadmin" && !isSuperadminPath(url)) return "/superadmin";
  // Ne-superadmin ne sme na /superadmin/* poteh
  if (vloga !== "superadmin" && isSuperadminPath(url)) return "/";
  return url;
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [napaka, setNapaka] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNapaka("");
    setLoading(true);
    try {
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json() as Uporabnik & { napaka?: string };
      if (!r.ok) {
        setNapaka(data.napaka ?? "Napaka pri prijavi");
      } else {
        login(data);
        getAndClearReturnUrl();
        // Poskusi v ozadju registrirati morebitne neregistrirane račune
        if (data.vloga !== "superadmin") {
          fetch(`${base}/api/racuni/retry-furs-batch`, { method: "POST", credentials: "include" })
            .then(r => r.ok ? r.json() : null)
            .then((result: { skupaj: number; uspesno: number; neuspesno: number } | null) => {
              if (result && result.uspesno > 0) {
                window.dispatchEvent(new CustomEvent("furs:retryDone", { detail: result }));
              }
            })
            .catch(() => { /* tiho */ });
        }
        // Vedno preusmeri na začetni zaslon
        const target = data.vloga === "superadmin" ? "/superadmin" : "/";
        setLocation(target);
      }
    } catch {
      setNapaka("Napaka pri povezavi s strežnikom");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-2xl border shadow-lg bg-card">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">POS Cockpit</h1>
          <p className="text-sm text-muted-foreground">Prijavite se za nadaljevanje</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Uporabniško ime</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Geslo</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          {napaka && (
            <p className="text-sm text-destructive font-medium">{napaka}</p>
          )}
          <Button type="submit" className="w-full" disabled={loading || !username || !password}>
            <LogIn className="w-4 h-4 mr-2" />
            {loading ? "Prijavljam..." : "Prijava"}
          </Button>
        </form>
      </div>
    </div>
  );
}
