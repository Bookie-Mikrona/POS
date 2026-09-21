---
name: Viva Android callback
description: Omejitev povratnega rezultata pri Viva Android ECR sale intentu iz spletnega POS-a.
---

Viva Android ECR `sale` rezultat mora sprejeti native Android Activity prek lastne URI sheme in `getIntent().getData()`. Navaden Chrome/PWA lahko po plačilu pride nazaj v ospredje, vendar JavaScript ne prejme zanesljivega `transactionId`.

**Why:** Praktični Viva Demo preizkusi so uspešno izvedli transakcijo in vrnili brskalnik v POS, vendar brez callback parametrov in brez klica na strežniški `confirm`. Uradna dokumentacija zahteva custom URI callback activity.

**How to apply:** POS odpre native bridge prek lastne `pay` URI sheme; bridge preveri kodiran kontekst, odpre Viva intent in prek ločene `result` URI poti sprejme callback. V POS sme vrniti le rezultat z ujemajočim `clientTransactionId`; POS nato uporabi obstoječi strežniški confirm. Bridge sam ne potrjuje plačila. Sam povratek aplikacije nikoli ni dokaz plačila; brez preverljivega rezultata ostane stanje UNKNOWN.

React Native `Linking.openURL()` na Androidu ne razčleni brskalniškega `intent://...#Intent` zapisa tako kot Chrome. Pred odpiranjem mora bridge preveriti scheme in dovoljeni Viva paket ter zahtevek pretvoriti v native `vivapayclient://pay/v1` URI.

**Why:** Neposredni ADB `ACTION_VIEW` preizkus z `vivapayclient://pay/v1` je Vivo na ZCS Z92 odprl, isti zahtevek prek bridga z nespremenjenim `intent://` pa ne.

**How to apply:** POS lahko zaradi izbire demo/produkcijskega paketa še vedno sestavi browser intent, bridge pa po preverjanju deklaracij odpre samo njegov native del brez `#Intent` fragmenta.

Pri Expo projektu z že ustvarjeno mapo `android/` sprememba `app.json` intent filtrov sama po sebi ne spremeni release APK-ja; končni APK mora biti pregledan, ali dejanski native manifest vsebuje custom URI filtre.

**Why:** Bridge `app.json` je pravilno deklariral shemo, vendar je release APK vseboval samo launcher filter, zato Chrome ni mogel odpreti Bridgea.

**How to apply:** Po spremembi deep-link konfiguracije sinhroniziraj native manifest oziroma varno regeneriraj native projekt ter z `aapt dump xmltree` preveri `VIEW`, `DEFAULT`, `BROWSABLE`, scheme in gostitelje v končnem APK-ju.

Pri lokalnem Android release buildu na omejenem Replit okolju naj bo za ta majhen bridge React Compiler izključen, Metro/Gradle pa naj uporabljata omejeno število workerjev.

**Why:** Vključen React Compiler je med Android bundlingom večkrat presegel časovne in pomnilniške omejitve ter povzročil restart workspacea; brez njega je isti arm64 release build uspel.

**How to apply:** React Compiler ni del plačilne ali URI logike, zato ga za bridge ne vključuj brez konkretne potrebe. Za fizični test lahko uporabiš arm64 testni APK; za distribucijo pripravi namenski produkcijski signing key.

Fizični Android POS preizkus lahko poteka neposredno na ZCS Z92, medtem ko Replitov shell nima nujno USB/ADB vidljivosti do te naprave.

**Why:** Odsotnost naprave iz `adb devices` v workspaceu ne pomeni, da naprava ni bila uporabljena za prejšnji fizični preizkus ali da se rezultat na njej ni zgodil.

**How to apply:** Rezultate testa na ZCS obravnavaj ločeno od lokalne ADB diagnostike; za ponovitev na isti napravi uporabi ročno namestitev APK-ja ali povezavo, ki jo naprava dejansko omogoča.

32-bitni `armeabi-v7a` release APK se na ZCS Z92 uspešno namesti prek Windows ADB; arm64 APK za to napravo ni združljiv.

**Why:** Praktična namestitev na konkretni napravi je potrdila ABI zahtevo, ki je prej povzročila `INSTALL_FAILED_NO_MATCHING_ABIS` pri arm64 paketu.

**How to apply:** Za ZCS Z92 uporabljaj `armeabi-v7a` build in ga nameščaj prek Windows ADB; arm64 builda ne ponujaj kot paket za to napravo.

Pri lokalni Gradle gradnji ZCS paketa nastavi oba parametra: `reactNativeArchitectures=armeabi-v7a` in projektni `bookie.releaseAbi=armeabi-v7a`. Sam drugi parameter ne prepreči CMake gradnje vseh ABI-jev.

**Why:** Gradnja samo z `bookie.releaseAbi` je še vedno kompilirala arm64, x86 in x86_64 ter presegla časovno omejitev; oba parametra sta izdelala preverjen 32-bitni APK znotraj omejitve.

**How to apply:** Za trajne Android manifest spremembe uporabi Expo config-plugin z uvozom iz `expo/config-plugins`, ker je generirana mapa `android/` ignorirana in neposredne spremembe niso trajne.

Android paket Bridgea mora biti povsod `com.bookievivabridge`: Expo `android.package`, native `applicationId` in Viva `appId` morajo ostati usklajeni.

**Why:** Različno paketno ime med Expo konfiguracijo in native gradnjo lahko ustvari ločeno aplikacijo ali prepreči nadgradnjo APK-ja na terminalu.

**How to apply:** Pred objavo APK-ja preveri paket in različico z `aapt dump badging`, podpis starega in novega paketa pa primerjaj z `apksigner verify --print-certs`.

ZCS različica Viva Bridgea uporablja neposredno native Android aktivnost in ne zaganja React Native/Hermesa.

**Why:** Expo/RN release se je na ZCS Z92 takoj sesul ob zagonu, čeprav so bile odvisnosti, ABI, bundle in podpis pravilni; most potrebuje le varno obdelavo URI-ja in zagon druge aplikacije.

**How to apply:** Native izvor hrani v sledenem plugin direktoriju, config-plugin pa ga po prebuild kopira v generirano `android/` mapo. Varnostna dovoljenja URI-jev ostanejo enaka kot v spletnem gradniku.

Android lahko povratni HTTPS naslov iz Bridgea odpre v novem brskalniškem ali PWA kontekstu, zato konteksta plačila ne hrani samo v `sessionStorage`.

**Why:** Fizični preizkus je uspešno izvedel plačilo in vrnil blagajno v ospredje, vendar novi kontekst ni videl `sessionStorage`; POS zato ni poklical strežniškega `confirm` in je naročilo pravilno pustil odprto.

**How to apply:** Preverljivi kontekst Viva poskusa hrani tudi v skupnem origin-local pomnilniku, ob callbacku ga vedno preveri proti strežniško rezerviranemu attemptu ter ga odstrani šele po potrjenem ali dokončno neuspešnem izidu. Asinhrona potrditev mora sprožiti nov render oziroma učinek za izdajo računa.

Bridge Activity mora po odprtju Viva Terminala ostati živa in skrita pod njim; `finishAndRemoveTask()` se sme poklicati šele po prejemu custom-URI callbacka in odprtju povratnega POS naslova.

**Why:** Na ZCS Z92 je takojšnje odstranjevanje Bridge taska povzročilo, da je Viva po zaključku razkrila prejšnji Chrome zaslon »Plačilo je pripravljeno« namesto callback aktivnosti.

**How to apply:** Launch Activity obravnava samo `pay`; ločena `CallbackActivity` je `singleTask`, `excludeFromRecents` in obravnava samo `result`, kot zahteva Viva. Povratna veja nato odpre POS in odstrani Bridge task.

Viva Bridge po callbacku ne sme odpirati povratnega HTTPS naslova z `ACTION_VIEW`. Rezultat začasno shrani in ga ponudi POS-u prek lokalnega HTTP kanala; nato odstrani svoj Android task, da se razkrije prvotni POS zavihek.

**Why:** `CLEAR_TOP`, `SINGLE_TOP`, `NEW_TASK` in PWA `navigate-existing` na dejanski napravi niso preprečili novih Chrome zavihkov. Chrome zavihki niso Android Activityji, zato nobena kombinacija teh zastavic ne zagotovi ponovne uporabe prvotnega zavihka.

**How to apply:** Med začetim plačilom POS preverja rezultat na loopback naslovu. Bridge po preverjenem Viva callbacku lokalno objavi povratni URL, ne zaganja brskalnika in odstrani svoj task. POS nato v istem zavihku uporabi `location.replace`, strežniški confirm pa ostane obvezen.

Na Samsung One UI callback najprej premakne celoten Bridge task v ozadje z `moveTaskToBack(true)` in nato zapre callback Activity; na drugih napravah ostane `finishAndRemoveTask()`.

**Why:** Samsung je po uspešnem Viva callbacku pustil prazen Bridge zaslon v ospredju, čeprav je bil rezultat že shranjen za POS polling; druge Android naprave tega niso kazale.

**How to apply:** Fallback omeji na proizvajalca Samsung in ne odpiraj HTTPS `ACTION_VIEW`, da ne nastajajo novi brskalniški zavihki.

Bookiejev trenutni Android Terminal/Bridge tok uporablja Viva Checkout OAuth naročilo, zato potrebuje »Pametne poverilnice za blagajno« (Smart Checkout Client ID + pripadajoči secret), ne ločenih »Poverilnic POS API-jev«.

**Why:** POS API poverilnice so namenjene predvsem aktivaciji terminala in Cloud REST/EFT POS API-ju; Bookie pa trenutno kliče OAuth `connect/token` in Checkout naročila, nato order odpre v Android Terminalu.

**How to apply:** Za demo uporabi Smart Checkout par iz demo portala in vključen demo način; za produkcijo ustrezen live par in izključen demo način. Obeh vrst poverilnic ne zamenjuj.