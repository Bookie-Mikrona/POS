import { BookMarked, UtensilsCrossed, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { markAppChoiceDone } from "@/lib/appChoice";

export default function AppChoicePage() {
  const [, setLocation] = useLocation();

  const openErp = () => {
    markAppChoiceDone();
    setLocation("/admin");
  };
  const openPos = () => {
    markAppChoiceDone();
    window.location.assign("/pos/superadmin");
  };

  const options = [
    { key: "erp", title: "Bookie-ERP", text: "Administracija sistema, podjetja, moduli.", Icon: BookMarked, onClick: openErp },
    { key: "pos", title: "POS gostinstvo", text: "Super-admin POS: podjetja, paketi, uporabniki.", Icon: UtensilsCrossed, onClick: openPos },
  ];

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Kam želite nadaljevati?</h1>
          <p className="text-sm text-muted-foreground">Prijavljeni ste kot super-admin.</p>
        </div>
        {options.map(({ key, title, text, Icon, onClick }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            data-testid={`app-choice-${key}`}
            className="flex w-full items-center gap-4 rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-primary hover:shadow"
          >
            <Icon className="h-6 w-6 shrink-0 text-primary" />
            <span className="flex-1">
              <span className="block font-medium">{title}</span>
              <span className="block text-sm text-muted-foreground">{text}</span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
