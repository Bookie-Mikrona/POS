---
name: ZCS bridge stale process
description: ZCS tiskalni most javlja "ni dosegljiv" čeprav teče — vzrok in rešitev
---

## Pravilo

Ko ZCS tiskalni most (APK na localhost:8090) poroča "ni dosegljiv" kljub temu da je aktiven,
je vzrok pogosto star proces iz prejšnje seje, ki drži port.

**Why:** Po restartu API strežnika ali Replit delovnega okolja ostane APK vezan na stari socket.

**How to apply:** Rešitev je restart aplikacije na ZCS napravi. Ni potreben noben popravek v kodi.

## Opomba (9. 8. 2026)

Pred rešitvijo nativnih knjižnic (zcs-bridge-tiskanje.md) je bil "ni dosegljiv" pogosto posledica
sesutega APK ob zagonu (manjkajoče `.so`). Zdaj, ko APK v1.1.0 deluje, je pravi vzrok "ni dosegljiv"
zares star/zamrznjen proces — rešitev ostaja enaka: restart APK na napravi.
