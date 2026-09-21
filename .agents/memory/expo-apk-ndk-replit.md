---
name: Expo APK NDK na Replitu
description: Kako lokalno zgraditi Expo Android APK, ko je Nix Android SDK samo za branje.
---

Pri lokalni Gradle gradnji Expo Android aplikacije nastavi skupni `ndkVersion` na različico, ki je že prisotna v Replitovem Android SDK, in to stori pred uporabo Expo root Gradle plugina.

**Why:** Nixov Android SDK je samo za branje. Če Expo privzeto zahteva drugo različico NDK, Gradle poskuša vanj namestiti manjkajoči paket in gradnja odpove, čeprav je združljiva novejša različica že nameščena.

**How to apply:** Pred APK gradnjo preveri `source.properties` oziroma imenik `ndk/` v SDK. Skupni `rootProject.ext.ndkVersion` nastavi pred Expo pluginom; sama nastavitev v aplikacijskem modulu ni dovolj, ker Expo knjižnice berejo skupno vrednost.