# Scanner Bridge — HP optični čitalnik za POS

Lokalni Windows servis, ki omogoča POS spletni aplikaciji direktno skeniranje
dokumentov prek HP optičnega čitalnika (WIA).

## Zahteve

- Windows 10 / 11
- Python 3.11+ **ali** preneseni `ScannerBridge.exe`
- HP scanner z nameščenimi WIA gonilniki
- Test: `wiaacmgr.exe` v Start meniju mora zaznati scanner

---

## Namestitev (.exe — brez Pythona)

1. Prenesi `ScannerBridge.exe`
2. Kopiraj ga kamorkoli — npr. `C:\Programi\ScannerBridge\ScannerBridge.exe`
3. Poženi `ScannerBridge.exe`
   - Ob prvem zagonu se **samodejno doda v Windows autostart** (Registry `HKCU\...\Run`)
   - Ikona se pojavi v sistemski vrstici (tray)
   - Ob ponovnem kliku dvojnega zagona ne odpre (zaščita)

### Odstranitev autostarta

```bat
ScannerBridge.exe --uninstall
```

---

## Namestitev (Python — razvoj)

```bat
pip install -r requirements.txt
python bridge.py
```

---

## Gradnja .exe

Na Windows računalniku z nameščenim Pythonom:

**CMD (ukazni poziv):**
```bat
pip install -r requirements.txt
.\build.bat
```

**PowerShell:**
```powershell
pip install -r requirements.txt
.\build.ps1
```

> Če PowerShell javi napako o izvajalni politiki, enkrat zaženite:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

Rezultat: `dist\ScannerBridge.exe` — enkratna datoteka, Python ni potreben.

**Opomba:** Skripta sama ustvari ikono in doda vse potrebne pywin32 skrite uvoz.

---

## API

| Metoda | Pot       | Opis                              |
|--------|-----------|-----------------------------------|
| GET    | /health   | Status + seznam zaznjenih scannerjev |
| POST   | /scan     | Sproži skeniranje, vrni base64 PNG |

### GET /health — odgovor

```json
{
  "status": "ok",
  "version": "1.1.0",
  "scanners": [
    { "id": "{...}", "name": "HP ScanJet Pro 3000" }
  ]
}
```

### POST /scan — parametri

```json
{
  "deviceId": null,
  "dpi": 300,
  "color": false,
  "format": "png"
}
```

| Parameter  | Vrednosti               | Privzeto | Opis                                    |
|------------|-------------------------|----------|-----------------------------------------|
| `deviceId` | ID iz `/health` ali null | null    | null = prvi zaznani scanner             |
| `dpi`      | 150, 300, 600           | 300      | Ločljivost; 300 priporočeno za OCR      |
| `color`    | true / false            | false    | false = sivinska (3× manjša datoteka)   |
| `format`   | "png" / "jpeg"          | "png"    | PNG je lossless; priporočen za OCR      |

### POST /scan — odgovor

```json
{
  "image": "<base64>",
  "mimeType": "image/png",
  "size": 1234567
}
```

---

## Odpravljanje težav

| Simptom                          | Rešitev                                                      |
|----------------------------------|--------------------------------------------------------------|
| Bridge ni zaznan                 | Poženi `ScannerBridge.exe`, preveri sistemsko vrstico (tray) |
| Scanner ni na seznamu `/health`  | Namesti WIA gonilnike za HP (HP Easy Start)                  |
| Napaka COM / ni dostopa          | Poženi enkrat kot administrator                               |
| Port 8765 zaseden                | Drug program zaseda port; preveri z `netstat -ano ^| findstr 8765` |
| EXE se zapre takoj               | Poženi iz ukazne vrstice (`cmd.exe`), preveri napako         |
| HTTPS / Mixed content napaka     | POS mora teči na HTTP ali bridge mora biti dostopen prek HTTPS tunela |

---

## Port in varnost

Bridge posluša **samo** na `http://127.0.0.1:8765` — dostopen je izključno z lokalne naprave,
ne iz omrežja. CORS wildcard (`*`) je varen v tej konfiguraciji.

---

## Autostart podrobnosti

Ob prvem zagonu `.exe` se doda vnos v Windows Registry:

```
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
  ScannerBridge = "C:\pot\do\ScannerBridge.exe"
```

Za ročno odstranitev: `regedit` → poiščite `ScannerBridge` pod `HKCU\...\Run` in izbrišite,
ali: `ScannerBridge.exe --uninstall`.
