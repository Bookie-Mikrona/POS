---
name: Viva Bridge Android ABI
description: Distribucijsko pravilo za ARM64 in armeabi-v7a različici Bookie Viva Bridge.
---

Bookie Viva Bridge ne sme uporabljati armeabi-v7a kot edine različice za vse Android uporabnike. Približno 90 % uporabnikov bo uporabljalo moderne mobilne Android naprave, zato mora biti nov, preverjen ARM64 paket primarna možnost. Armeabi-v7a ostane ločena možnost za ZCS Z92 in druge potrjeno 32-bitne naprave. Starega nedelujočega ARM64 APK-ja ne objavi.

**Why:** Moderni arm64-only telefoni ne morejo nujno namestiti 32-bitnega armeabi-v7a APK-ja, ZCS Z92 pa potrebuje preverjeno 32-bitno različico.

**How to apply:** Pri vsaki izdaji zgradi in z `aapt dump badging` preveri oba ABI-ja; ARM64 objavi za moderne telefone, armeabi-v7a pa jasno označi za ZCS Z92.

Na Replitu lahko enoten Expo/Gradle release build prekorači razpoložljive vire pri Metro ali lint koraku. Zanesljiv postopek je dvostopenjski: aktualni JS bundle in njegove vire pripravi ločeno, nato Gradle release paketira s prebundlanimi viri, enim workerjem, izključenim release lintom in eksplicitnim `abiFilters` za ciljni ABI. Ne zanašaj se samo na `reactNativeArchitectures`, ker lahko stara React Native arhitektura v APK vseeno zapakira predzgrajene knjižnice vseh ABI-jev.

**Why:** Izključitev bundle naloge z Gradle `-x` zlomi odvisnost `mapReleaseSourceSetPaths`; brez eksplicitnega ABI filtra pa navidezna ARM64 gradnja ustvari velik univerzalni APK.

**How to apply:** Končni artefakt sprejmi šele, ko `aapt dump badging` pokaže natanko želeni `native-code`, APK vsebuje `assets/index.android.bundle`, podpis se uspešno preveri in prenesena strežniška kopija da enak rezultat.