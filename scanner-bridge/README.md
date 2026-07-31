# Scanner Bridge — HP optični čitalnik za POS

Lokalni Windows servis, ki omogoča POS spletni aplikaciji direktno skeniranje
dokumentov prek HP optičnega čitalnika (WIA).

## Zahteve

- Windows 10 / 11
- Python 3.11+ **ali** preneseni `ScannerBridge.exe`
- HP scanner z nameščenimi WIA gonilniki
- Test: `wiaacmgr.exe` v Start meniju mora zaznati scanner

---

## Namestitev (Python)

```bat
pip install -r requirements.txt
python bridge.py
```

## Namestitev (.exe — brez Pythona)

1. Prenesi `ScannerBridge.exe` iz `dist/` mape
2. Poženi `ScannerBridge.exe` — pojavi se ikona v system tray-u
3. Ob prvem zagonu se samodejno doda v Windows autostart

## Gradnja .exe

```bat
pip install -r requirements.txt
build.bat
```

---

## API

| Metoda | Pot       | Opis                              |
|--------|-----------|-----------------------------------|
| GET    | /health   | Status + seznam zaznjenih scannerjev |
| POST   | /scan     | Sproži skeniranje, vrni base64 PNG |

### POST /scan — parametri

```json
{
  "deviceId": null,
  "dpi": 300,
  "color": false,
  "format": "png"
}
```

- `deviceId` — ID scannerja iz `/health`. `null` = prvi najden
- `dpi` — 150, 300 (privzeto) ali 600
- `color` — `false` = sivinska (priporočeno za OCR, 3× manjša datoteka)
- `format` — `"png"` (privzeto, lossless) ali `"jpeg"`

### Odgovor

```json
{
  "image": "<base64>",
  "mimeType": "image/png",
  "size": 1234567
}
```

---

## Odpravljanje težav

| Simptom | Rešitev |
|---------|---------|
| Bridge ni zaznan | Poženi `ScannerBridge.exe`, preveri firewall |
| Scanner ni na seznamu | Namesti WIA gonilnike za HP (HP Easy Start) |
| Napaka COM | Poženi kot administrator (enkrat) |
| HTTPS / Mixed content | Nastavi ALLOWED_ORIGINS v `bridge.py` |

---

## Port

Bridge posluša na `http://127.0.0.1:8765`. Dostopen je samo z lokalne naprave.
