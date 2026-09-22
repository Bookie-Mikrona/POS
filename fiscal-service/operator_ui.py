"""Standard-user Windows UI for Bookie Local Gateway.

This module intentionally uses only the Python standard library and never
opens the protected gateway database. All status and actions cross the
loopback HTTP boundary owned by the LocalSystem service.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import platform
import sys
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any


DEFAULT_ORIGIN = os.environ.get("BOOKIE_FISCAL_ALLOWED_ORIGIN", "https://pos.bookie.si")
READINESS_LABELS = {
    "not_provisioned": "Terminal še ni pripravljen za izbrano poslovno enoto.",
    "provisioning_incomplete": "Priprava poslovne enote ni dokončana.",
    "device_key_missing": "Manjka identiteta terminala.",
    "signed_provisioning_bundle_missing": "Manjka podpisano dovoljenje za delo brez omrežja.",
    "furs_certificate_missing": "Manjka certifikat FURS.",
    "furs_certificate_fingerprint_mismatch": "Certifikat FURS se ne ujema s pripravljeno enoto.",
    "printer_not_configured": "Tiskalnik ni nastavljen.",
    "disk_low": "Na disku ni dovolj prostora.",
    "furs_v2_legal_core_golden_vector_missing": "Fiskalno jedro še ni potrjeno za produkcijsko uporabo.",
}


def base_url(port: int, use_tls: bool) -> str:
    return f"{'https' if use_tls else 'http'}://{'localhost' if use_tls else '127.0.0.1'}:{port}/v1"


def request_json(method: str, url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = urllib.request.Request(url, method=method, headers=headers or {"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def show_message(title: str, message: str, error: bool = False) -> None:
    flags = 0x10 if error else 0x40
    ctypes.windll.user32.MessageBoxW(None, message, title, flags)


def is_windows_admin() -> bool:
    try:
        return platform.system() == "Windows" and bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def run_connection_code(port: int, use_tls: bool) -> int:
    if not is_windows_admin():
        show_message("Bookie Offline POS", "Za ustvarjanje povezovalne kode je potrebna potrditev skrbnika.", True)
        return 1
    token_path = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "BookieFiscal" / "admin-token.txt"
    try:
        token = token_path.read_text(encoding="utf-8").strip()
        if not token:
            raise RuntimeError("Administratorska identiteta manjka.")
        result = request_json(
            "POST",
            f"{base_url(port, use_tls)}/admin/connection-code",
            {"Accept": "application/json", "X-Bookie-Admin-Token": token},
        )
        code = str(result.get("code", ""))
        if len(code) != 6 or not code.isdigit():
            raise RuntimeError("Storitev ni vrnila veljavne kode.")
        expires = datetime.fromisoformat(str(result["expiresAt"]).replace("Z", "+00:00")).astimezone()
        show_message(
            "Bookie Offline POS",
            f"Koda za povezavo POS-a:\n\n{code}\n\n"
            f"Velja do {expires.strftime('%d.%m.%Y %H:%M')} in jo je mogoče uporabiti samo enkrat.\n"
            "Vnesite jo v Bookie POS v nastavitvah lokalne fiskalne storitve.",
        )
        return 0
    except Exception:
        show_message(
            "Bookie Offline POS",
            "Kode ni bilo mogoče ustvariti. Preverite, ali je lokalna storitev zagnana. "
            "Če težava ostane, pokličite skrbnika.",
            True,
        )
        return 1


def run_operator_ui(port: int, use_tls: bool) -> int:
    if platform.system() != "Windows":
        raise SystemExit("Bookie Offline POS is available only on Windows.")
    import tkinter as tk
    from tkinter import messagebox, ttk

    root = tk.Tk()
    root.title("Bookie Offline POS")
    root.geometry("620x520")
    root.minsize(560, 460)
    gateway_url = base_url(port, use_tls)
    status_text = tk.StringVar(value="Preverjanje lokalne storitve …")
    detail_text = tk.StringVar(value="")
    queue_text = tk.StringVar(value="")
    state: dict[str, Any] = {"posUrl": DEFAULT_ORIGIN}

    frame = ttk.Frame(root, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="Bookie Offline POS", font=("Segoe UI", 20, "bold")).pack(anchor="w")
    ttk.Label(frame, text="Nadzor samostojnega Windows terminala", font=("Segoe UI", 10)).pack(anchor="w", pady=(0, 20))
    ttk.Label(frame, textvariable=status_text, font=("Segoe UI", 15, "bold"), wraplength=540).pack(anchor="w", pady=(0, 8))
    ttk.Label(frame, textvariable=detail_text, wraplength=540, justify="left").pack(anchor="w", pady=(0, 12))
    ttk.Label(frame, textvariable=queue_text, wraplength=540, justify="left").pack(anchor="w", pady=(0, 20))
    buttons = ttk.Frame(frame)
    buttons.pack(fill="x", pady=(8, 0))

    def refresh(show_confirmation: bool = False) -> None:
        try:
            data = request_json("GET", f"{gateway_url}/operator/status")
            state["posUrl"] = data.get("posUrl") or DEFAULT_ORIGIN
            problems = list(data.get("readinessProblems") or [])
            if data.get("ready"):
                status_text.set("Terminal je pripravljen za gotovinsko delo brez omrežja")
                detail_text.set("Lokalna storitev, fiskalna identiteta in tiskalnik so pripravljeni.")
            else:
                status_text.set("Terminal ni pripravljen")
                detail_text.set("\n".join(f"• {READINESS_LABELS.get(item, item)}" for item in problems)
                                or "Pokličite skrbnika.")
            delivery = data.get("deliveryCounts") or {}
            prints = data.get("printCounts") or {}
            pending = sum(int(delivery.get(key, 0)) for key in ("PENDING", "RECEIVED", "FINALIZING", "UNKNOWN"))
            review = int(delivery.get("NEEDS_REVIEW", 0)) + int(prints.get("NEEDS_REVIEW", 0))
            queue_text.set(
                f"Računi za poznejšo oddajo: {pending}\n"
                f"Postavke, ki zahtevajo pregled: {review}\n"
                f"Odprta lokalna naročila: {'da' if data.get('hasOpenLocalOrders') else 'ne'}"
            )
            if show_confirmation and data.get("ready"):
                messagebox.showinfo("Bookie Offline POS", "Preverjanje je uspešno. Terminal je pripravljen.")
        except Exception:
            status_text.set("Lokalna storitev ni dosegljiva")
            detail_text.set("Ponovno zaženite računalnik. Če težava ostane, pokličite skrbnika.")
            queue_text.set("")

    def sync_now() -> None:
        try:
            request_json("POST", f"{gateway_url}/operator/sync")
            messagebox.showinfo("Bookie Offline POS", "Sinhronizacija je sprožena. Terminal naj ostane povezan z internetom.")
            root.after(1500, refresh)
        except Exception:
            messagebox.showerror("Bookie Offline POS", "Sinhronizacije ni bilo mogoče sprožiti.")

    def connection_code() -> None:
        action_args = f'--operator-connection-code --port {port}' + (" --tls" if use_tls else "")
        if getattr(sys, "frozen", False):
            executable, args = sys.executable, action_args
        else:
            executable, args = sys.executable, f'"{Path(__file__).resolve().parent / "fiscal_service.py"}" {action_args}'
        result = ctypes.windll.shell32.ShellExecuteW(None, "runas", executable, args, None, 1)
        if result <= 32:
            messagebox.showerror("Bookie Offline POS", "Skrbniška potrditev ni uspela.")

    ttk.Button(buttons, text="Preveri pripravljenost", command=lambda: refresh(True)).grid(row=0, column=0, padx=(0, 8), pady=4, sticky="ew")
    ttk.Button(buttons, text="Sinhroniziraj zdaj", command=sync_now).grid(row=0, column=1, padx=8, pady=4, sticky="ew")
    ttk.Button(buttons, text="Koda za povezavo POS-a", command=connection_code).grid(row=1, column=0, padx=(0, 8), pady=4, sticky="ew")
    ttk.Button(buttons, text="Odpri Bookie POS", command=lambda: webbrowser.open(state["posUrl"])).grid(row=1, column=1, padx=8, pady=4, sticky="ew")
    ttk.Button(buttons, text="Zapri", command=root.destroy).grid(row=2, column=1, padx=8, pady=(16, 4), sticky="e")
    buttons.columnconfigure(0, weight=1)
    buttons.columnconfigure(1, weight=1)
    refresh()
    root.mainloop()
    return 0


def run_from_argv(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--operator", action="store_true")
    parser.add_argument("--operator-connection-code", action="store_true")
    parser.add_argument("--port", type=int, default=17831)
    parser.add_argument("--tls", action="store_true")
    args, _ = parser.parse_known_args(argv)
    if args.operator_connection_code:
        return run_connection_code(args.port, args.tls)
    if args.operator:
        return run_operator_ui(args.port, args.tls)
    return 2