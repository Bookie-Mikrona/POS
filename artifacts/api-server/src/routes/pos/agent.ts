/**
 * Windows tiskalni agent — endpointi brez Clerk JWT (auth prek agentTiskalnikToken).
 *
 * GET  /print/agent/skript.ps1          — generira PS1 z vdelanim tokenom, tiskalnikom in URL
 * GET  /print/agent/pozeni.bat          — statični BAT zaganjalnik
 * POST /print/agent/heartbeat           — zabeleži dosegljivost agenta
 * GET  /print/agent/naloge              — atomarno prevzame (lease) eno nalogo
 * POST /print/agent/naloge/:id/izvrseno — varno ACK-a uspeh ali napako naloge
 */

import { Router, type Request, type Response } from "express";
import { db, nastavitveTable, tiskalneNalogeTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { PRINT_LEASE_SECONDS, PRINT_MAX_ATTEMPTS } from "../../lib/pos-print-queue";

const router = Router();

// ── Pomožna: poišči enotaId iz agentTiskalnikToken ──────────────────────────
async function enotaIdIzTokena(token: string): Promise<number | null> {
  if (!token) return null;
  const [row] = await db
    .select({ enotaId: nastavitveTable.enotaId })
    .from(nastavitveTable)
    .where(
      and(
        eq(nastavitveTable.kljuc, "agentTiskalnikToken"),
        eq(nastavitveTable.vrednost, token),
      ),
    )
    .limit(1);
  return row?.enotaId ?? null;
}

// ── GET /print/agent/skript.ps1 ─────────────────────────────────────────────
// Zahteva: ?token=<agentTiskalnikToken>&printer=<ime tiskalnika>
// Vrne dinamično generiran PowerShell skript z vdelanimi vrednostmi.
router.get("/print/agent/skript.ps1", async (req: Request, res: Response): Promise<void> => {
  const token   = String(req.query["token"]   ?? "").trim();
  const printer = String(req.query["printer"] ?? "").trim();

  if (!token) {
    res.status(400).send("Manjka ?token= parameter.");
    return;
  }

  // Preveri da token obstaja v DB (prepreči generiranje za neznan token)
  const enotaId = await enotaIdIzTokena(token);
  if (enotaId === null) {
    res.status(403).send("Neveljaven token.");
    return;
  }

  // Klient posreduje točen zunanji URL (vključno z Vite-proxy prefiksom, npr. /pos/api/print/agent).
  // Če ni podan, ga poskusimo sestaviti iz proxy headerjev — a to morda ne vsebuje bazne poti.
  const apiBaseParam = String(req.query["apiBase"] ?? "").trim();
  const proto = (req.get("x-forwarded-proto") ?? req.protocol).split(",")[0]?.trim() ?? "https";
  const host  = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  const apiBase = apiBaseParam || `${proto}://${host}/api/print/agent`;

  const tiskalnikEscaped = printer.replace(/"/g, '""');

  const skript = `# POS Tiskalni Agent - samodejno generiran
$token     = "${token}"
$api       = "${apiBase}"
$tiskalnik = "${tiskalnikEscaped}"

# Win32 API za direktno posiljanje ESC/POS bajtov
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class WinPrint{
  [DllImport("winspool.Drv",EntryPoint="OpenPrinterA")]public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr p);
  [DllImport("winspool.Drv",EntryPoint="ClosePrinter")]public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="StartDocPrinterA")]public static extern int StartDocPrinter(IntPtr h,int l,[In,MarshalAs(UnmanagedType.LPStruct)]DocInfo d);
  [DllImport("winspool.Drv",EntryPoint="EndDocPrinter")]public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="StartPagePrinter")]public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="EndPagePrinter")]public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="WritePrinter")]public static extern bool WritePrinter(IntPtr h,IntPtr b,int c,out int w);
}
[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Ansi)]
public class DocInfo{[MarshalAs(UnmanagedType.LPStr)]public string pDocName;[MarshalAs(UnmanagedType.LPStr)]public string pOutputFile;[MarshalAs(UnmanagedType.LPStr)]public string pDataType;}
"@ -ErrorAction SilentlyContinue

function Tiskaj-Raw([byte[]]$data){
    $h=[IntPtr]::Zero
    $ok=[WinPrint]::OpenPrinter($tiskalnik,[ref]$h,[IntPtr]::Zero)
    if(-not $ok -or $h -eq [IntPtr]::Zero){
        Write-Host "NAPAKA: Tiskalnik '$tiskalnik' ni najden ali ni dosegljiv."
        Write-Host "  Zazenite: Get-WmiObject Win32_Printer | Select-Object Name"
        Write-Host "  in preverite, da je ime tocno enako."
        return $false
    }
    $di=New-Object DocInfo;$di.pDocName="POS-Racun";$di.pDataType="RAW"
    $docId=[WinPrint]::StartDocPrinter($h,1,$di)
    if($docId -le 0){
        Write-Host "NAPAKA: StartDocPrinter ni uspel (koda $docId)."
        [WinPrint]::ClosePrinter($h)|Out-Null
        return $false
    }
    [WinPrint]::StartPagePrinter($h)|Out-Null
    $ptr=[System.Runtime.InteropServices.Marshal]::AllocHGlobal($data.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($data,0,$ptr,$data.Length)
    $w=0
    $wr=[WinPrint]::WritePrinter($h,$ptr,$data.Length,[ref]$w)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
    if(-not $wr -or $w -ne $data.Length){
        Write-Host "NAPAKA: WritePrinter ni uspel (poslano $w / $($data.Length) bajtov)."
    }
    [WinPrint]::EndPagePrinter($h)|Out-Null
    [WinPrint]::EndDocPrinter($h)|Out-Null
    [WinPrint]::ClosePrinter($h)|Out-Null
    return $wr
}

# Samodejni zagon ob Windows prijavi
$scriptPath = if ($MyInvocation.MyCommand.Path) { $MyInvocation.MyCommand.Path } \`
              elseif ($PSCommandPath) { $PSCommandPath } \`
              else { $null }

if ($scriptPath) {
    # Metoda 1: Startup mapa (brez admin pravic) - VBScript zazene PS skripto skrito
    $startupDir = [Environment]::GetFolderPath("Startup")
    $vbsPath = Join-Path $startupDir "POS-TiskalniAgent.vbs"
    if (-not (Test-Path $vbsPath)) {
        $vbs = 'CreateObject("WScript.Shell").Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' + $scriptPath + '""", 0, False'
        Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII
        Write-Host "Samodejni zagon registriran v Startup mapi (ob naslednji prijavi se agent zazene samodejno)"
    }
    # Metoda 2: Task Scheduler (zahteva admin - doda zagon za vse uporabnike)
    $taskName = "POS-TiskalniAgent"
    if (!(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
        try {
            $action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$scriptPath\`""
            $trigger = New-ScheduledTaskTrigger -AtLogOn
            Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -RunLevel Highest -Force -ErrorAction Stop | Out-Null
            Write-Host "Samodejni zagon registriran tudi v Task Schedulerju"
        } catch { Write-Host "Info: Task Scheduler ni bil registriran (brez admin - Startup mapa zadostuje)" }
    }
} else {
    Write-Host "Opozorilo: pot skripte ni bila zaznana."
    Write-Host "  Shranite .ps1 datoteko na disk in jo zazenite z desnim klikom -> Zazi s PowerShellom."
    Write-Host "  Samodejni zagon ni bil nastavljen."
}

Write-Host "POS tiskalni agent zagnan. Tiskalnik: $tiskalnik"
Write-Host "Za ustavitev pritisnite Ctrl+C"

while ($true) {
    try {
        Invoke-RestMethod "$api/heartbeat?token=$token" -Method POST -ContentType "application/json" -Body (@{printer=$tiskalnik}|ConvertTo-Json) | Out-Null
        $jobs = Invoke-RestMethod "$api/naloge?token=$token&printer=$([uri]::EscapeDataString($tiskalnik))"
        foreach ($j in $jobs) {
            $bytes = [Convert]::FromBase64String($j.bajti)
            $uspeh = Tiskaj-Raw $bytes
            $ack = @{ claimToken=$j.claimToken; success=$uspeh; error=if($uspeh){""}else{"Windows spooler rejected the job"} } | ConvertTo-Json
            Invoke-RestMethod "$api/naloge/$($j.id)/izvrseno?token=$token" -Method POST -ContentType "application/json" -Body $ack | Out-Null
            if($uspeh){
                Write-Host "$(Get-Date -Format 'HH:mm:ss') Natisnjen racun $($j.racunId) ($($bytes.Length) bajtov)"
            } else {
                Write-Host "$(Get-Date -Format 'HH:mm:ss') NAPAKA pri tiskanju racuna $($j.racunId) - preverite ime tiskalnika!"
            }
        }
    } catch { Write-Host "$(Get-Date -Format 'HH:mm:ss') Napaka: $_" }
    Start-Sleep 2
}
`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="pos-tiskalnik.ps1"');
  res.setHeader("Cache-Control", "no-store");
  res.send(skript);
});

// ── GET /print/agent/pozeni.bat ─────────────────────────────────────────────
router.get("/print/agent/pozeni.bat", (_req: Request, res: Response): void => {
  const bat = `@echo off
rem POS Tiskalni Agent - zaganjalnik
rem Shranite obe datoteki v isto mapo in dvokliknite to .bat datoteko.

set "SKRIPT=%~dp0pos-tiskalnik.ps1"

if not exist "%SKRIPT%" (
    echo NAPAKA: pos-tiskalnik.ps1 ni bila najdena v isti mapi.
    echo Prenesita pos-tiskalnik.ps1 in jo shranite v isto mapo kot ta datoteka.
    pause
    exit /b 1
)

echo POS tiskalni agent se zaganja...
powershell.exe -ExecutionPolicy Bypass -WindowStyle Normal -File "%SKRIPT%"

rem Ce je agent zakljucil z napako, je sporocilo vidno zgoraj
pause
`;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", 'attachment; filename="pozeni-agent.bat"');
  res.setHeader("Cache-Control", "no-store");
  res.send(bat);
});

const MAX_ATTEMPTS = PRINT_MAX_ATTEMPTS;
const LEASE_SECONDS = PRINT_LEASE_SECONDS;
const agentIdentity = (token: string) => `agent:${createHash("sha256").update(token).digest("hex")}`;
const validPrinter = (value: unknown) => typeof value === "string" && value.trim().length <= 200 ? value.trim() : "";

// A small liveness record lets administrators distinguish a queued job from an
// offline printer. It is token scoped, so one unit can never report another.
router.post("/print/agent/heartbeat", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.query["token"] ?? "").trim();
  const enotaId = await enotaIdIzTokena(token);
  const printer = validPrinter(req.body?.printer ?? req.query["printer"]);
  if (enotaId === null) { res.status(403).json({ error: "Neveljaven token." }); return; }
  if (!printer) { res.status(400).json({ error: "printer je obvezen." }); return; }
  await db.execute(sql`
    INSERT INTO pos_printer_heartbeats (enota_id, printer_key, agent_id, last_seen_at, metadata)
    VALUES (${enotaId}, ${printer}, ${agentIdentity(token)}, now(), ${JSON.stringify(req.body?.metadata ?? {})}::jsonb)
    ON CONFLICT (enota_id, printer_key) DO UPDATE
      SET agent_id = EXCLUDED.agent_id, last_seen_at = EXCLUDED.last_seen_at, metadata = EXCLUDED.metadata`);
  res.json({ ok: true });
});

// Atomically leases at most one job. SKIP LOCKED makes simultaneous agents
// safe; an expired lease is eligible for another agent.
router.get("/print/agent/naloge", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.query["token"] ?? "").trim();
  const enotaId = await enotaIdIzTokena(token);
  const printer = validPrinter(req.query["printer"]);
  if (enotaId === null) { res.status(403).json({ error: "Neveljaven token." }); return; }
  const claimToken = `${agentIdentity(token)}:${randomUUID()}`;
  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT id FROM tiskalne_naloge
      WHERE enota_id = ${enotaId} AND destination = 'agent'
        AND (printer_key IS NULL OR printer_key = ${printer})
        AND ((status = 'queued' AND available_at <= now())
          OR (status = 'running' AND lease_until < now()))
      ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE tiskalne_naloge q SET status = 'running', attempts = q.attempts + 1,
      claimed_at = now(), claimed_by = ${claimToken},
      lease_until = now() + (${LEASE_SECONDS} * interval '1 second')
    FROM candidate WHERE q.id = candidate.id
    RETURNING q.id, q.racun_id AS "racunId", q.bajti, q.purpose, q.attempts,
      q.lease_until AS "leaseUntil"`);
  const job = result.rows[0];
  res.json(job ? [{ ...job, claimToken }] : []);
});

// ACK is a compare-and-set on the current lease. A duplicate success returns
// success without incrementing receipt prints again; a late ACK cannot mutate a
// job claimed by a newer agent.
router.post("/print/agent/naloge/:id/izvrseno", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.query["token"] ?? "").trim();
  const id    = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID." }); return; }
  const enotaId = await enotaIdIzTokena(token);
  const claimToken = typeof req.body?.claimToken === "string" ? req.body.claimToken : "";
  const success = req.body?.success !== false; // old agents ACK without a body
  const error = typeof req.body?.error === "string" ? req.body.error.slice(0, 2000) : "Tiskalnik ni potrdil tiskanja.";
  if (enotaId === null) { res.status(403).json({ error: "Neveljaven token." }); return; }
  if (!claimToken) { res.status(409).json({ error: "ACK potrebuje claimToken iz naloge." }); return; }
  if (success) {
    const result = await db.execute(sql`
      WITH acknowledged AS (
        UPDATE tiskalne_naloge SET status = 'printed', ack_at = now(), completed_at = now(),
          lease_until = NULL, last_error = NULL
        WHERE id = ${id} AND enota_id = ${enotaId} AND status = 'running'
          AND claimed_by = ${claimToken}
        RETURNING racun_id
      ), incremented AS (
        UPDATE racuni SET stevilo_printov = stevilo_printov + 1
        WHERE id IN (SELECT racun_id FROM acknowledged WHERE racun_id IS NOT NULL)
        RETURNING id
      ) SELECT (SELECT count(*)::int FROM acknowledged) AS changed`);
    const changed = Number(result.rows[0]?.changed ?? 0);
    if (changed) { res.json({ ok: true, status: "printed" }); return; }
  } else {
    const result = await db.execute(sql`
      UPDATE tiskalne_naloge SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'needs_review' ELSE 'queued' END,
        available_at = now() + (LEAST(300, 5 * power(2, GREATEST(attempts - 1, 0))) * interval '1 second'),
        ack_at = now(), lease_until = NULL, last_error = ${error}
      WHERE id = ${id} AND enota_id = ${enotaId} AND status = 'running' AND claimed_by = ${claimToken}
      RETURNING status, available_at AS "availableAt", attempts`);
    if (result.rows[0]) { res.json({ ok: true, ...result.rows[0] }); return; }
  }
  const row = (await db.select({ status: tiskalneNalogeTable.status }).from(tiskalneNalogeTable)
    .where(and(eq(tiskalneNalogeTable.id, id), eq(tiskalneNalogeTable.enotaId, enotaId))).limit(1))[0];
  if (!row) { res.status(404).json({ error: "Naloga ni najdena." }); return; }
  res.json({ ok: true, status: row.status, duplicateOrLate: true });
});

export default router;
