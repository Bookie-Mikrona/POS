"""
HP Scanner Bridge — Windows lokalni servis za spletno POS aplikacijo.

Komunikacija: POS browser → HTTP localhost:8765 → WIA COM → HP scanner

Zaganjanje:
  pip install -r requirements.txt
  python bridge.py

Pakiranje v .exe:
  pyinstaller --onefile --noconsole --icon=scanner.ico bridge.py
"""

import sys
import os
import base64
import tempfile
import threading
import ctypes
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import pystray
    from PIL import Image as PILImage
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False

# ── Nastavitve ────────────────────────────────────────────────────────────────

PORT         = 8765
HOST         = "127.0.0.1"
VERSION      = "1.0.0"

# Dovoli dostop z POS app-a (nastavi na pravi origin v produkciji)
ALLOWED_ORIGINS = ["*"]  # lokalni bridge — dostopen samo z localhost, wildcard je varen

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
    """Preveri, ali bridge teče, in vrni seznam zaznjanih scannerjev."""
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
    Sprozi skeniranje in vrni base64 sliko.
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

def _make_tray_icon():
    """Ustvari minimalistično ikono za tray (brez zunanjega .ico)."""
    try:
        img = PILImage.new("RGB", (64, 64), color=(30, 120, 200))
        return img
    except Exception:
        return None


def _run_tray():
    if not HAS_TRAY:
        return

    icon_img = _make_tray_icon()
    if icon_img is None:
        return

    def on_quit(icon, item):
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("Scanner Bridge — HP", None, enabled=False),
        pystray.MenuItem(f"Port: {PORT}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Zapri", on_quit),
    )

    icon = pystray.Icon("ScannerBridge", icon_img, "Scanner Bridge", menu)
    icon.run()


# ── Autostart (Registry) ──────────────────────────────────────────────────────

def _enable_autostart():
    """Dodaj v Windows Registry za autostart ob prijavi uporabnika."""
    try:
        import winreg
        exe_path = sys.executable if not getattr(sys, "frozen", False) else sys.executable
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0, winreg.KEY_SET_VALUE,
        )
        winreg.SetValueEx(key, "ScannerBridge", 0, winreg.REG_SZ, f'"{exe_path}"')
        winreg.CloseKey(key)
        log.info("Autostart v Registry dodan.")
    except Exception as e:
        log.warning(f"Autostart ni bil dodan: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info(f"Scanner Bridge v{VERSION} — port {PORT}")

    # Autostart ob prvem zagonu
    if getattr(sys, "frozen", False):  # samo v .exe
        _enable_autostart()

    # Zaženi tray v ločenem thread-u
    tray_thread = threading.Thread(target=_run_tray, daemon=True)
    tray_thread.start()

    # Zaženi HTTP strežnik
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
