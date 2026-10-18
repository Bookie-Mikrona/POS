import { useEffect, useState } from "react";
import { getGetErpSmtpSettingsQueryKey, useDeleteErpSmtpSettings, useGetErpSmtpSettings, useSaveErpSmtpSettings, useTestErpSmtpSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ErpSmtpInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Zahteva ni uspela.";
}

export function ErpSmtpSettings({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const query = useGetErpSmtpSettings(companyId, { query: { queryKey: getGetErpSmtpSettingsQueryKey(companyId), refetchOnWindowFocus: false } });
  const save = useSaveErpSmtpSettings();
  const test = useTestErpSmtpSettings();
  const remove = useDeleteErpSmtpSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState<ErpSmtpInput>({ host: "", port: 465, user: "", from: "", password: "" });
  const [recipient, setRecipient] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (query.data && !dirty) {
      setForm({ host: query.data.host, port: query.data.port as 465 | 587, user: query.data.user, from: query.data.from, password: "" });
    }
  }, [query.data, dirty]);
  const busy = save.isPending || test.isPending || remove.isPending;
  const edit = (name: keyof ErpSmtpInput, value: string | number) => {
    setForm(f => ({ ...f, [name]: value })); setDirty(true); setNotice("");
    save.reset(); test.reset(); remove.reset();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>E-pošta poročil (SMTP)</CardTitle>
        <CardDescription>Nastavitve veljajo samo za poročila tega podjetja. Geslo je shranjeno šifrirano.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {query.isLoading ? <p role="status">Nalaganje nastavitev …</p> : query.isError ? (
          <div role="alert"><p>{message(query.error)}</p><Button variant="outline" onClick={() => query.refetch()}>Poskusi znova</Button></div>
        ) : (
          <>
            <p className="text-sm">{query.data?.configured ? "Pošiljanje poročil po e-pošti je nastavljeno." : "Pošiljanje poročil po e-pošti ni nastavljeno. Prenos PDF-jev je na voljo."}</p>
            <form className="space-y-4" onSubmit={async e => {
              e.preventDefault(); setNotice(""); test.reset();
              try {
                await save.mutateAsync({ companyId, data: { ...form, host: form.host.trim(), user: form.user.trim(), from: form.from.trim() } });
                setForm(f => ({ ...f, password: "" })); setDirty(false);
                await query.refetch();
                setNotice("SMTP nastavitve so shranjene.");
              } catch { /* Mutation error is rendered below. */ }
            }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="erp-smtp-host">SMTP strežnik</Label>
                  <Input id="erp-smtp-host" required maxLength={253} value={form.host} disabled={busy} placeholder="mail.example.si" onChange={e => edit("host", e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="erp-smtp-port">Šifrirana povezava</Label>
                  <select id="erp-smtp-port" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.port} disabled={busy} onChange={e => edit("port", Number(e.target.value))}>
                    <option value={465}>465 — TLS</option><option value={587}>587 — STARTTLS</option>
                  </select></div>
                <div className="space-y-2"><Label htmlFor="erp-smtp-user">Uporabniško ime</Label>
                  <Input id="erp-smtp-user" required maxLength={320} value={form.user} disabled={busy} autoComplete="off" onChange={e => edit("user", e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="erp-smtp-password">Geslo</Label>
                  <Input id="erp-smtp-password" type="password" required={!query.data?.passwordSet} maxLength={1024} value={form.password} disabled={busy} autoComplete="new-password" placeholder={query.data?.passwordSet ? "Prazno ohrani shranjeno geslo" : "Vnesite geslo"} onChange={e => edit("password", e.target.value)} /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="erp-smtp-from">E-pošta pošiljatelja</Label>
                  <Input id="erp-smtp-from" type="email" required maxLength={320} value={form.from} disabled={busy} onChange={e => edit("from", e.target.value)} />
                  <p className="text-xs text-muted-foreground">Naslov, ki ga SMTP strežnik dovoljuje. Prejemnik vidi naziv podjetja.</p></div>
              </div>
              <Button type="submit" disabled={busy || !dirty}>{save.isPending ? "Shranjevanje …" : "Shrani SMTP nastavitve"}</Button>
            </form>
            <form className="space-y-3 border-t pt-4" onSubmit={async e => {
              e.preventDefault(); setNotice(""); save.reset();
              try {
                await test.mutateAsync({ companyId, data: { recipient: recipient.trim() } });
                setNotice("SMTP strežnik je sprejel testno sporočilo. Preverite tudi neželeno pošto.");
              } catch { /* Mutation error is rendered below. */ }
            }}>
              <Label htmlFor="erp-smtp-recipient">Prejemnik testnega sporočila</Label>
              <Input id="erp-smtp-recipient" type="email" required maxLength={320} value={recipient} onChange={e => setRecipient(e.target.value)} disabled={busy} />
              <p className="text-xs text-muted-foreground">{dirty ? "Pred testom shranite spremembe." : "Test uporablja shranjene nastavitve."}</p>
              <Button type="submit" variant="outline" disabled={busy || dirty || !query.data?.configured}>{test.isPending ? "Pošiljanje …" : "Pošlji testno e-pošto"}</Button>
            </form>
            {query.data?.configured && (
              <AlertDialog open={confirmOpen} onOpenChange={open => { if (!remove.isPending) setConfirmOpen(open); }}>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" disabled={busy}>Izklopi pošiljanje poročil</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Izklopim pošiljanje poročil po e-pošti?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Odstranjene bodo SMTP nastavitve tega podjetja in shranjeno geslo. Za ponovni vklop bo treba podatke vnesti znova.
                      Prenos poročil v PDF ostane na voljo. Nastavitve POS pošte se ne spremenijo.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={remove.isPending}>Prekliči</AlertDialogCancel>
                    <AlertDialogAction disabled={remove.isPending} onClick={async e => {
                      e.preventDefault(); setNotice(""); save.reset(); test.reset();
                      try {
                        const settings = await remove.mutateAsync({ companyId });
                        await queryClient.cancelQueries({ queryKey: getGetErpSmtpSettingsQueryKey(companyId) });
                        queryClient.setQueryData(getGetErpSmtpSettingsQueryKey(companyId), settings);
                        setForm({ host: "", port: 465, user: "", from: "", password: "" });
                        setRecipient(""); setDirty(false); setConfirmOpen(false);
                        setNotice("Pošiljanje poročil po e-pošti je izklopljeno. SMTP nastavitve in geslo so odstranjeni. Prenos PDF-jev ostaja na voljo.");
                      } catch { /* Keep confirmation open and render the mutation error. */ }
                    }}>{remove.isPending ? "Izklapljanje …" : "Izklopi in odstrani nastavitve"}</AlertDialogAction>
                  </AlertDialogFooter>
                  {remove.error && <p role="alert" className="text-sm text-destructive">{message(remove.error)}</p>}
                </AlertDialogContent>
              </AlertDialog>
            )}
            {(save.error || test.error || (!confirmOpen && remove.error)) && <p role="alert" className="text-sm text-destructive">{message(save.error || test.error || remove.error)}</p>}
            {notice && <p role="status" className="text-sm">{notice}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
