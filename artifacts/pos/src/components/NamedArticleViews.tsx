import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ArticleViewState,
  type NamedArticleView,
  normalizeArticleViewName,
  parseNamedArticleViews,
  QR_FEEDBACK_NAMED_ARTICLE_VIEWS_STORAGE_KEY,
} from "@/lib/qr-feedback-article-views";

function readViews(): NamedArticleView[] {
  try {
    return parseNamedArticleViews(window.localStorage.getItem(QR_FEEDBACK_NAMED_ARTICLE_VIEWS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function NamedArticleViews({ view, onApply }: {
  view: ArticleViewState;
  onApply: (view: ArticleViewState) => void;
}) {
  const [views, setViews] = useState(readViews);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function persist(next: NamedArticleView[], success: string): boolean {
    try {
      window.localStorage.setItem(QR_FEEDBACK_NAMED_ARTICLE_VIEWS_STORAGE_KEY, JSON.stringify(next));
      setViews(next);
      setError("");
      setMessage(success);
      return true;
    } catch {
      setMessage("");
      setError("Spremembe ni bilo mogoče shraniti v ta brskalnik. Preverite dovoljenja in prostor za shranjevanje ter poskusite znova.");
      return false;
    }
  }

  return (
    <section className="space-y-2" aria-label="Poimenovani pogledi artiklov">
      <p className="text-xs text-muted-foreground">Poimenovani pogledi · shranjeni samo v tem brskalniku</p>
      <form className="flex flex-wrap gap-2" onSubmit={event => {
        event.preventDefault();
        const trimmed = name.trim();
        setMessage("");
        if (!trimmed) {
          setError("Vnesite ime pogleda.");
          return;
        }
        if (views.some(saved => normalizeArticleViewName(saved.name) === normalizeArticleViewName(trimmed))) {
          setError("Pogled s tem imenom že obstaja. Izberite drugo ime.");
          return;
        }
        if (persist([...views, { name: trimmed, view }], `Pogled »${trimmed}« je shranjen.`)) setName("");
      }}>
        <Input
          className="min-w-0 flex-1"
          aria-label="Ime pogleda"
          placeholder="Ime pogleda"
          maxLength={80}
          value={name}
          onChange={event => { setName(event.target.value); setError(""); setMessage(""); }}
        />
        <Button type="submit" variant="outline" size="sm">Shrani pogled</Button>
      </form>
      {views.length > 0 && (
        <ul className="space-y-1">
          {views.map(saved => (
            <li key={saved.name} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-words text-sm">{saved.name}</span>
              <Button type="button" variant="secondary" size="sm" aria-label={`Uporabi pogled ${saved.name}`} onClick={() => {
                onApply(saved.view);
                setError("");
                setMessage(`Pogled »${saved.name}« je uporabljen.`);
              }}>Uporabi</Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Izbriši pogled ${saved.name}`} onClick={() => {
                persist(views.filter(entry => entry.name !== saved.name), `Pogled »${saved.name}« je izbrisan.`);
              }}>Izbriši</Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
