import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListDocumentsQueryKey,
  useRegisterDocument,
  useRequestUploadUrl,
  type CompanyWithRole,
} from "@workspace/api-client-react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trackEvent } from "@/lib/analytics";

type UploadItem = {
  name: string;
  status: "queued" | "uploading" | "uploaded" | "error";
  error?: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function DocumentUpload({ company }: { company: CompanyWithRole | null }) {
  const queryClient = useQueryClient();
  const requestUpload = useRequestUploadUrl();
  const registerDocument = useRegisterDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [batch, setBatch] = useState<{ companyName: string; items: UploadItem[] } | null>(null);

  useEffect(() => {
    if (!uploading) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [uploading]);

  const updateItem = (index: number, patch: Partial<UploadItem>) => {
    setBatch(previous => previous && ({
      ...previous,
      items: previous.items.map((item, i) => i === index ? { ...item, ...patch } : item),
    }));
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length || !company || company.role === "viewer" || inFlight.current) return;

    // Freeze the target tenant before awaiting anything, including for later files.
    const companyId = company.id;
    inFlight.current = true;
    setUploading(true);
    setBatch({
      companyName: company.kratekNaziv || company.naziv || company.id,
      items: files.map(file => ({ name: file.name, status: "queued" })),
    });

    try {
      // Each file gets its own upload URL and document. Failures do not abort the batch.
      for (const [index, file] of files.entries()) {
        updateItem(index, { status: "uploading" });
        let registering = false;
        try {
          const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
          const contentType = file.type || MIME_BY_EXTENSION[extension];
          if (!contentType || !Object.values(MIME_BY_EXTENSION).includes(contentType)) {
            throw new Error("Podprti so PDF, JPG, PNG in WEBP.");
          }
          if (!file.size) throw new Error("Datoteka je prazna.");

          const { uploadURL, objectPath } = await requestUpload.mutateAsync({
            data: { name: file.name, size: file.size, contentType },
          });
          const response = await fetch(uploadURL, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: file,
          });
          if (!response.ok) throw new Error(`Prenos datoteke ni uspel (HTTP ${response.status}).`);

          registering = true;
          await registerDocument.mutateAsync({
            companyId,
            data: { objectPath, fileName: file.name, mimeType: contentType, fileSizeBytes: file.size },
          });
          updateItem(index, { status: "uploaded" });
          void queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(companyId) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Nalaganje ni uspelo.";
          updateItem(index, {
            status: "error",
            error: registering
              ? `${message} Registracije ni bilo mogoče potrditi; pred ponovnim nalaganjem preverite seznam dokumentov.`
              : message,
          });
          continue;
        }

        // Analytics must not turn a successful registration into an upload failure.
        try {
          trackEvent("document_imported", {
            mime_type_group: file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
            file_size_bucket: file.size < 1_000_000 ? "under_1mb" : file.size < 5_000_000 ? "1_5mb" : "over_5mb",
          });
        } catch (error) {
          console.error("Napaka pri beleženju uvoza dokumenta:", error);
        }
      }
    } finally {
      inFlight.current = false;
      setUploading(false);
    }
  };

  const items = batch?.items ?? [];
  const uploaded = items.filter(item => item.status === "uploaded").length;
  const errors = items.filter(item => item.status === "error");
  const finished = uploaded + errors.length;
  const current = items.find(item => item.status === "uploading");

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        aria-label="Izberite dokumente za nalaganje"
        className="hidden"
        disabled={uploading || !company || company.role === "viewer"}
        onChange={handleFiles}
      />
      <Button
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
        disabled={uploading || !company || company.role === "viewer"}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
        {uploading ? `Nalaganje ${Math.min(finished + 1, items.length)}/${items.length}…` : "Naloži dokumente"}
      </Button>
      {!batch && <p className="mt-2 text-xs text-muted-foreground">Izberete lahko več datotek hkrati s Ctrl ali Shift.</p>}
      {batch && (
        <div className="mt-3 space-y-2 text-xs">
          <div role="status" aria-live="polite">
            <p className="font-medium">{uploading ? `Obravnavanih ${finished} od ${items.length}` : `Uspešno naloženih ${uploaded} od ${items.length} dokumentov.`}</p>
            <p className="text-muted-foreground">Za podjetje: {batch.companyName}</p>
            {current && <p className="truncate" title={current.name}>{current.name}</p>}
          </div>
          <Progress value={items.length ? finished / items.length * 100 : 0} aria-label="Napredek nalaganja dokumentov" />
          <p className="text-muted-foreground">Naloženi dokumenti se nato ločeno obdelajo z AI.</p>
          {errors.length > 0 && (
            <div role="alert" className="max-h-40 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive">
              <p className="font-medium">Ni uspelo: {errors.length}</p>
              <ul className="mt-1 space-y-1">
                {errors.map((item, index) => <li key={index}><strong className="break-all">{item.name}</strong>: {item.error}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}