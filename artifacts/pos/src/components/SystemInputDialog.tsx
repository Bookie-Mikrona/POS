import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  vrednost: string;
  onPotrdi: (vrednost: string) => void;
  onPreklic: () => void;
  naslov?: string;
  placeholder?: string;
}

export default function SystemInputDialog({
  vrednost,
  onPotrdi,
  onPreklic,
  naslov,
  placeholder,
}: Props) {
  const [besedilo, setBesedilo] = useState(vrednost);

  useEffect(() => setBesedilo(vrednost), [vrednost]);

  return (
    <div data-pos-keyboard-overlay className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <form
        className="w-full max-w-lg space-y-3 rounded-lg border bg-background p-4 shadow-xl"
        onSubmit={event => {
          event.preventDefault();
          onPotrdi(besedilo);
        }}
      >
        {naslov && <label htmlFor="system-input-dialog-field" className="text-sm font-medium">{naslov}</label>}
        <Input
          id="system-input-dialog-field"
          autoFocus
          value={besedilo}
          onChange={event => setBesedilo(event.target.value)}
          placeholder={placeholder ?? "Vnesite besedilo…"}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onPreklic}>Prekliči</Button>
          <Button type="submit">Potrdi</Button>
        </div>
      </form>
    </div>
  );
}