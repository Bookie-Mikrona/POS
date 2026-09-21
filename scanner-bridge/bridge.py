"""
HP Scanner Bridge — Windows lokalni servis za spletno POS aplikacijo.

Komunikacija: POS browser → HTTP localhost:8765 → WIA COM → HP scanner

Zaganjanje:
  pip install -r requirements.txt
  python bridge.py

Pakiranje v .exe:
  pip install -r requirements.txt
  build.bat

Odklop avtostarta:
  ScannerBridge.exe --uninstall
"""

import sys
import os
import base64
import tempfile
import threading
import ctypes
import time
import logging
import socket
import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import pystray
    from PIL import Image as PILImage, ImageDraw
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False

# ── Nastavitve ────────────────────────────────────────────────────────────────

PORT         = 8765
HOST         = "127.0.0.1"
VERSION      = "1.1.0"
APP_NAME     = "ScannerBridge"

# Dovoli dostop z POS app-a (lokalni bridge — wildcard je varen)
ALLOWED_ORIGINS = ["*"]

# WIA Property IDs
WIA_HORIZONTAL_RESOLUTION = 6147
WIA_VERTICAL_RESOLUTION   = 6148
WIA_HORIZONTAL_EXTENT     = 6151
WIA_VERTICAL_EXTENT       = 6152
WIA_CURRENT_INTENT        = 4103  # 1=color, 2=grayscale, 4=B&W

# A4 dimenzije pri 300dpi (px)
A4_W_300DPI = 2480
A4_H_300DPI = 3508

# WIA format GUID-i
WIA_FORMAT_PNG  = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"
WIA_FORMAT_JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("scanner-bridge")

# ── WIA STA thread pool ───────────────────────────────────────────────────────
# WIA COM mora teči v STA thread-u (Single Thread Apartment).
# ThreadPoolExecutor z max_workers=1 zagotovi serializacijo.

_sta_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="wia-sta")

def _init_sta():
    """Inicializiraj COM v STA načinu za WIA."""
    try:
        ctypes.windll.ole32.CoInitializeEx(None, 0x0)  # COINIT_APARTMENTTHREADED = 0x0
    except Exception:
        pass

_sta_executor.submit(_init_sta).result()


def _run_in_sta(fn, *args, **kwargs):
    """Poženi funkcijo v WIA STA thread-u in počakaj na rezultat."""
    future = _sta_executor.submit(fn, *args, **kwargs)
    return future.result(timeout=60)


# ── WIA pomožne funkcije ──────────────────────────────────────────────────────

def _wia_set_prop(props, prop_id: int, value):
    """Nastavi WIA property po ID-ju."""
    for i in range(1, props.Count + 1):
        try:
            p = props(i)
            if p.PropertyID == prop_id:
                p.Value = value
                return
        except Exception:
            pass


def _get_scanners_sta():
    """Vrni seznam WIA scannerjev (mora teči v STA thread-u)."""
    import win32com.client
    wia = win32com.client.Dispatch("WIA.DeviceManager")
    scanners = []
    for i in range(1, wia.DeviceInfos.Count + 1):
        try:
            info = wia.DeviceInfos(i)
            if info.Type == 1:  # ScannerDeviceType
                scanners.append({
                    "id":   info.DeviceID,
                    "name": info.Properties("Name").Value,
                })
        except Exception as e:
            log.warning(f"DeviceInfo {i} napaka: {e}")
    return scanners


def _scan_sta(device_id: str | None, dpi: int, color: bool, fmt: str):
    """Skeniraj dokument (mora teči v STA thread-u). Vrne pot do tmp datoteke."""
    import win32com.client

    wia = win32com.client.Dispatch("WIA.DeviceManager")

    # Izberi napravo
    device_info = None
    for i in range(1, wia.DeviceInfos.Count + 1):
        info = wia.DeviceInfos(i)
        if info.Type == 1:
            if device_id is None or info.DeviceID == device_id:
                device_info = info
                break

    if device_info is None:
        raise RuntimeError("Scanner ni najden. Preverite, da je priključen in vklopljen.")

    dev = device_info.Connect()

    if dev.Items.Count == 0:
        raise RuntimeError("Scanner nima skenirnih virov.")

    item = dev.Items(1)
    props = item.Properties

    _wia_set_prop(props, WIA_HORIZONTAL_RESOLUTION, dpi)
    _wia_set_prop(props, WIA_VERTICAL_RESOLUTION,   dpi)
    _wia_set_prop(props, WIA_HORIZONTAL_EXTENT,     A4_W_300DPI if dpi == 300 else int(8.27 * dpi))
    _wia_set_prop(props, WIA_VERTICAL_EXTENT,       A4_H_300DPI if dpi == 300 else int(11.69 * dpi))
    _wia_set_prop(props, WIA_CURRENT_INTENT,        1 if color else 2)

    wia_fmt = WIA_FORMAT_PNG if fmt == "png" else WIA_FORMAT_JPEG
    image = item.Transfer(wia_fmt)

    ext  = "png" if fmt == "png" else "jpg"
    path = os.path.join(tempfile.gettempdir(), f"scanner_bridge_{int(time.time())}.{ext}")
    if os.path.exists(path):
        os.remove(path)

    image.SaveFile(path)

    # WIA lahko shrani nestandardni PNG (npr. 16-bit siva) — normaliziramo na 8-bit
    try:
        pil_img = PILImage.open(path).convert('L' if not color else 'RGB')
        pil_img.save(path, 'PNG', optimize=False)
    except Exception as e:
        log.warning(f"PIL normalizacija slike ni uspela: {e}")

    return path


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="Scanner Bridge", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    deviceId: str | None = None
    dpi:      int        = 300    # 150, 300, 600
    color:    bool       = False  # False = grayscale (manjša datoteka, dovolj za OCR)
    format:   str        = "png"  # "png" ali "jpeg"


@app.get("/health")
async def health():
    """Preveri, ali bridge teče, in vrni seznam zaznjenih scannerjev."""
    try:
        scanners = _run_in_sta(_get_scanners_sta)
    except Exception as e:
        log.warning(f"WIA napaka pri zaznavanju: {e}")
        scanners = []

    return {
        "status":   "ok",
        "version":  VERSION,
        "scanners": scanners,
    }


@app.post("/scan")
async def scan(req: ScanRequest):
    """
    Sproži skeniranje in vrni base64 sliko.
    Zahteva: { deviceId?, dpi?, color?, format? }
    Odgovor: { image: "<base64>", mimeType: "image/png", size: <bytes> }
    """
    if req.dpi not in (150, 300, 600):
        raise HTTPException(400, "dpi mora biti 150, 300 ali 600")
    if req.format not in ("png", "jpeg"):
        raise HTTPException(400, "format mora biti 'png' ali 'jpeg'")

    log.info(f"Skeniranje: device={req.deviceId}, dpi={req.dpi}, color={req.color}, fmt={req.format}")

    try:
        path = _run_in_sta(_scan_sta, req.deviceId, req.dpi, req.color, req.format)
    except RuntimeError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        log.error(f"Skeniranje neuspešno: {e}")
        raise HTTPException(500, f"Napaka pri skeniranju: {e}")

    try:
        with open(path, "rb") as f:
            data = f.read()
        os.remove(path)
    except Exception as e:
        raise HTTPException(500, f"Napaka pri branju slike: {e}")

    mime = "image/png" if req.format == "png" else "image/jpeg"
    return {
        "image":    base64.b64encode(data).decode(),
        "mimeType": mime,
        "size":     len(data),
    }


# ── Tray icon ─────────────────────────────────────────────────────────────────

def _make_tray_icon(size: int = 64) -> "PILImage.Image | None":
    """Nariši preprosto ikono optičnega čitalnika (bela stran + modra puščica navzdol)."""
    try:
        s = size
        img = PILImage.new("RGBA", (s, s), (0, 0, 0, 0))
        d   = ImageDraw.Draw(img)

        # Ozadje — zaokrožen pravokotnik (simuliran z ovalom + pravokotnikom)
        bg = (240, 245, 255, 255)
        d.rectangle([0, 0, s - 1, s - 1], fill=bg)

        # Telo skenerja — temno modri pravokotnik (spodnja tretjina)
        body_color = (30, 100, 200, 255)
        d.rectangle([s // 8, s * 5 // 8, s * 7 // 8, s * 7 // 8], fill=body_color)

        # Steklo / plošča skenerja — svetlo modra
        glass_color = (160, 200, 255, 255)
        d.rectangle([s // 8, s // 8, s * 7 // 8, s * 9 // 16], fill=glass_color)

        # Puščica (skeniranje navzdol) — bela, centrirana v glavi
        cx = s // 2
        ay = s * 3 // 16
        aw = s // 5
        ah = s // 4
        # navpična linija
        d.rectangle([cx - aw // 6, ay, cx + aw // 6, ay + ah * 2 // 3], fill=(255, 255, 255, 255))
        # trikotna konica
        arrow_pts = [
            (cx - aw // 2, ay + ah * 2 // 3),
            (cx + aw // 2, ay + ah * 2 // 3),
            (cx,           ay + ah),
        ]
        d.polygon(arrow_pts, fill=(255, 255, 255, 255))

        return img
    except Exception:
        return None


def _run_tray():
    if not HAS_TRAY:
        return

    icon_img = _make_tray_icon(64)
    if icon_img is None:
        return

    def on_quit(icon, item):
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem(f"Scanner Bridge v{VERSION}", None, enabled=False),
        pystray.MenuItem(f"http://{HOST}:{PORT}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Zapri", on_quit),
    )

    icon = pystray.Icon(APP_NAME, icon_img, f"Scanner Bridge v{VERSION}", menu)
    icon.run()


# ── Autostart (Registry) ──────────────────────────────────────────────────────

_AUTOSTART_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def _enable_autostart():
    """
    Dodaj v Windows Registry za autostart ob prijavi.
    Idempotentno — ne piše, če je pot že pravilna.
    """
    try:
        import winreg
        exe_path  = sys.executable
        reg_value = f'"{exe_path}"'

        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _AUTOSTART_KEY,
            0, winreg.KEY_ALL_ACCESS,
        )
        try:
            existing, _ = winreg.QueryValueEx(key, APP_NAME)
            if existing == reg_value:
                log.info("Autostart že registriran — preskočeno.")
                winreg.CloseKey(key)
                return
        except FileNotFoundError:
            pass  # ključ še ne obstaja — dodamo

        winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, reg_value)
        winreg.CloseKey(key)
        log.info(f"Autostart dodan: {reg_value}")
    except Exception as e:
        log.warning(f"Autostart ni bil dodan: {e}")


def _disable_autostart():
    """Odstrani Scanner Bridge iz Windows autostart."""
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _AUTOSTART_KEY,
            0, winreg.KEY_ALL_ACCESS,
        )
        try:
            winreg.DeleteValue(key, APP_NAME)
            log.info("Autostart odstranjen.")
            print("Scanner Bridge je bil odstranjen iz avtomatskega zagona.")
        except FileNotFoundError:
            print("Scanner Bridge ni bil registriran v avtomatskem zagonu.")
        winreg.CloseKey(key)
    except Exception as e:
        log.warning(f"Napaka pri odstranjevanju autostarta: {e}")


# ── Zaščita pred dvojnim zagonom ──────────────────────────────────────────────

def _port_prosta() -> bool:
    """Vrni True, če port 8765 ni zaseden (= bridge še ne teče)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.3)
        result = s.connect_ex((HOST, PORT))
        s.close()
        return result != 0  # 0 = povezava uspela = port zaseden
    except Exception:
        return True


def _pokazi_ze_tece():
    """Prikaži Windows MessageBox, da bridge že teče."""
    try:
        ctypes.windll.user32.MessageBoxW(
            0,
            f"Scanner Bridge že teče na http://{HOST}:{PORT}.\n"
            f"Preverite sistemsko vrstico (tray).",
            "Scanner Bridge",
            0x40,  # MB_ICONINFORMATION
        )
    except Exception:
        print(f"[INFO] Scanner Bridge že teče na http://{HOST}:{PORT}.")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scanner Bridge")
    parser.add_argument(
        "--uninstall",
        action="store_true",
        help="Odstrani Scanner Bridge iz Windows autostart in zapri.",
    )
    args = parser.parse_args()

    if args.uninstall:
        _disable_autostart()
        sys.exit(0)

    log.info(f"Scanner Bridge v{VERSION} — port {PORT}")

    # Prepreči dvojni zagon
    if not _port_prosta():
        log.warning("Port %d je že zaseden — bridge morda že teče.", PORT)
        if getattr(sys, "frozen", False):
            _pokazi_ze_tece()
        sys.exit(0)

    # Autostart — samo v .exe načinu, idempotentno
    if getattr(sys, "frozen", False):
        _enable_autostart()

    # Zaženi tray v ločenem thread-u
    tray_thread = threading.Thread(target=_run_tray, daemon=True)
    tray_thread.start()

    # Zaženi HTTP strežnik
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning", log_config=None)
