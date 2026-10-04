import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlergenKoda,
  AlergenStatus,
  AlergenVir,
  useRegisterDocument,
  useRequestUploadUrl,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FileUp, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

export type AlergenSnapshot = {
  alergeni: AlergenKoda[];
  alergeniSledi: AlergenKoda[];
  alergeniStatus: AlergenStatus;
  alergeniVir: AlergenVir | null;
  alergeniOpombaVira: string | null;
  alergeniDocumentId: string | null;
};

export const STANDARD_ALLERGENS: { koda: AlergenKoda; naziv: string }[] = [
  { koda: "GLUTEN", naziv: "Žita, ki vsebujejo gluten" },
  { koda: "RAKI", naziv: "Raki in proizvodi iz njih" },
  { koda: "JAJCA", naziv: "Jajca in proizvodi iz njih" },
  { koda: "RIBE", naziv: "Ribe in proizvodi iz njih" },
  { koda: "ARASIDI", naziv: "Arašidi (kikiriki) in proizvodi iz njih" },
  { koda: "SOJA", naziv: "Zrnje soje in proizvodi iz nje" },
  { koda: "MLEKO", naziv: "Mleko in mlečni proizvodi (ki vsebujejo laktozo)" },
  { koda: "OREŠČKI", naziv: "Oreščki (mandlji, lešniki, orehi, ...)" },
  { koda: "ZELENA", naziv: "Zelena in proizvodi iz nje" },
  { koda: "GORČICA", naziv: "Gorčično seme in proizvodi iz njega" },
  { koda: "SEZAM", naziv: "Sezamovo seme in proizvodi iz njega" },
  { koda: "SULFITI", naziv: "Žveplov dioksid in sulfiti (>10 mg/kg)" },
  { koda: "VOLČJI_BOB", naziv: "Volčji bob in proizvodi iz njega" },
  { koda: "MEHKUŽCI", naziv: "Mehkužci in proizvodi iz njih" },
];

export function AlergenEditor({
  value,
  onChange,
  disabled = false,
  companyId,
}: {
  value: AlergenSnapshot;
  onChange: (value: AlergenSnapshot) => void;
  disabled?: boolean;
  companyId?: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const requestUpload = useRequestUploadUrl();
  const registerDocument = useRegisterDocument();

  const update = <K extends keyof AlergenSnapshot>(key: K, val: AlergenSnapshot[K]) => {
    onChange({ ...value, [key]: val });
  };

  const toggleAllergen = (koda: AlergenKoda, list: "alergeni" | "alergeniSledi") => {
    const current = value[list];
    if (current.includes(koda)) {
      update(list, current.filter((k) => k !== koda));
    } else {
      const otherList = list === "alergeni" ? "alergeniSledi" : "alergeni";
      onChange({
        ...value,
        [list]: [...current, koda],
        [otherList]: value[otherList].filter((item) => item !== koda),
      });
    }
  };

  const handleStatusChange = (status: AlergenStatus) => {
    onChange(status === "potrjeno_brez"
      ? { ...value, alergeniStatus: status, alergeni: [], alergeniSledi: [] }
      : { ...value, alergeniStatus: status });
  };

  const handleEvidenceUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!companyId) {
      setUploadError("Podjetje ni izbrano, zato dokazila ni mogoče naložiti.");
      return;
    }
    const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 20 * 1024 * 1024) {
      setUploadError("Dovoljeni so PDF, JPG, PNG in WEBP do 20 MB.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const { uploadURL, objectPath } = await requestUpload.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("Prenos datoteke ni uspel.");
      const document = await registerDocument.mutateAsync({
        companyId,
        data: {
          objectPath,
          fileName: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size,
        },
      });
      update("alergeniDocumentId", document.id);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Nalaganje dokazila ni uspelo.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Status preverjenosti</Label>
          <p className="text-xs text-muted-foreground">
            Pri novi nabavni surovini se alergeni samodejno poiščejo na spletu v ozadju.
            Rezultat ostane nepreverjen; po končanem iskanju ponovno odprite artikel za pregled virov.
          </p>
          <Select
            disabled={disabled}
            value={value.alergeniStatus}
            onValueChange={(v) => handleStatusChange(v as AlergenStatus)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nepreverjeno">Nepreverjeno</SelectItem>
              <SelectItem value="potrjeno_brez">Potrjeno BREZ alergenov</SelectItem>
              <SelectItem value="potrjeno">Potrjeno in preverjeno</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Vir podatkov</Label>
          <Select
            disabled={disabled}
            value={value.alergeniVir ?? "none"}
            onValueChange={(v) => update("alergeniVir", v === "none" ? null : (v as AlergenVir))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Izberite vir..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez / Neznano</SelectItem>
              <SelectItem value="etiketa">Etiketa embalaže</SelectItem>
              <SelectItem value="specifikacija">Specifikacija proizvajalca</SelectItem>
              <SelectItem value="izjava_dobavitelja">Izjava dobavitelja</SelectItem>
              <SelectItem value="normativ">Normativ (izračun)</SelectItem>
              <SelectItem value="rocno">Ročno preverjanje</SelectItem>
              <SelectItem value="drugo">Drugo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Opomba k viru</Label>
          <Input
            disabled={disabled}
            value={value.alergeniOpombaVira ?? ""}
            onChange={(e) => update("alergeniOpombaVira", e.target.value || null)}
            placeholder="Dodatno pojasnilo..."
          />
        </div>
        <div className="space-y-2">
          <Label>Dokazilo o deklaraciji</Label>
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(event) => void handleEvidenceUpload(event.target.files?.[0])}
            />
            {value.alergeniDocumentId ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-green-50 p-2 text-sm text-green-800">
                <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Dokazilo je priloženo</span>
                <Button type="button" size="icon" variant="ghost" disabled={disabled} onClick={() => update("alergeniDocumentId", null)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" disabled={disabled || uploading || !companyId} onClick={() => fileInputRef.current?.click()}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
                {uploading ? "Nalaganje…" : "Naloži PDF ali fotografijo"}
              </Button>
            )}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          </div>
        </div>
      </div>

      {value.alergeniStatus !== "potrjeno_brez" && (
        <div className="space-y-3">
          <Label>Prisotnost alergenov</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 p-4 border rounded-md bg-muted/20">
            <div className="font-semibold text-sm mb-1 col-span-full grid grid-cols-[1fr_auto_auto] gap-4">
              <span>Alergen</span>
              <span className="text-center w-16">Vsebuje</span>
              <span className="text-center w-16">Sledi</span>
            </div>
            {STANDARD_ALLERGENS.map((a) => (
              <div key={a.koda} className="col-span-full grid grid-cols-[1fr_auto_auto] gap-4 items-center py-1 border-b last:border-0 border-border/50">
                <span className="text-sm">{a.naziv}</span>
                <div className="w-16 flex justify-center">
                  <Checkbox
                    disabled={disabled}
                    checked={value.alergeni.includes(a.koda)}
                    onCheckedChange={() => toggleAllergen(a.koda, "alergeni")}
                  />
                </div>
                <div className="w-16 flex justify-center">
                  <Checkbox
                    disabled={disabled}
                    checked={value.alergeniSledi.includes(a.koda)}
                    onCheckedChange={() => toggleAllergen(a.koda, "alergeniSledi")}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AlergeniBadge({
  snapshot,
  className,
}: {
  snapshot: AlergenSnapshot | undefined | null;
  className?: string;
}) {
  if (!snapshot) return null;

  if (snapshot.alergeniStatus === "potrjeno_brez") {
    return <Badge className={`bg-green-100 text-green-800 border-green-200 hover:bg-green-200 ${className}`}>Brez alergenov</Badge>;
  }

  if (snapshot.alergeniStatus === "nepreverjeno") {
    return <Badge variant="outline" className={`text-orange-600 border-orange-200 bg-orange-50 hover:bg-orange-100 ${className}`}>Nepreverjeno</Badge>;
  }

  const count = snapshot.alergeni.length + snapshot.alergeniSledi.length;
  if (count === 0) {
    return <Badge variant="secondary" className={className}>Potrjeno (0)</Badge>;
  }

  return (
    <Badge className={`bg-red-100 text-red-800 border-red-200 hover:bg-red-200 ${className}`}>
      Vsebuje ({snapshot.alergeni.length}) {snapshot.alergeniSledi.length > 0 && `+ ${snapshot.alergeniSledi.length} sledi`}
    </Badge>
  );
}
