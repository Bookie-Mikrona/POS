---
name: POS actor PIN brez ERP računa
description: Pravilo za prijavo natakarjev in obnovljiv začetni tok na skupnem POS terminalu.
---

Natakar na skupnem POS terminalu ne potrebuje lastnega ERP oziroma Clerk računa. Njegovo operativno identiteto določa kratkotrajna actor seja, pridobljena z ID-jem natakarja in osebnim PIN-om.

**Why:** Samodejni polnozaslonski zaklep brez actor seje je ustvaril zagonsko zanko: vodja ni mogel priti do nastavitev in natakarju določiti PIN-a, natakar pa ni imel lastne ERP prijave.

**How to apply:** Brez actor seje naj bo mogoče priti do administratorskih nastavitev; funkcije, ki zahtevajo aktivnega natakarja, naj odprejo izbiro ID+PIN. PIN nastavi vodja v šifrantu natakarjev, ne z ustvarjanjem ERP računa.

Podpis actor seje prednostno uporablja namenski `POS_ACTOR_SESSION_SECRET`, sicer obstoječi `SESSION_SECRET`; brez obeh mora strežnik odpovedati zaprto.

QuickSwitch za pridobitev nove actor seje mora ignorirati in pred zahtevo odstraniti star actor token; sicer pretečena ali na drugo enoto vezana seja blokira preverjanje pravilnega novega ID-ja in PIN-a.

POS naprava si po uspešnem QuickSwitchu lokalno zapomni zadnji ID natakarja. Naslednji odklep zahteva samo PIN, vedno pa mora ostati vidna možnost »Uporabi drug ID«.

Actor PIN seja se sme izdati samo natakarju z odprto izmeno v aktivni enoti in mora biti kriptografsko vezana na ID te izmene. Velja do zaprtja izmene, največ 16 ur; strežnik odprto izmeno preveri pri vsakem občutljivem dejanju. Uspešen preklop hkrati določi operativnega natakarja za nova naročila in račune.

**Why:** PIN brez povezave z izmeno je dovoljeval delo pod zaprto izmeno in drugačno identiteto od natakarja na naročilu.

**How to apply:** Ob PIN prijavi preveri `konec IS NULL`; actor identiteta ima prednost pred odjemalčevim izborom natakarja. Z-zaključek lastne blagajne ostane mogoč po zaprtju izmene prek prijavljene Clerk identitete.

Blagajna ostane ves dan prijavljena s skupnim Clerk računom (npr. blagajna@podjetje.si). Natakar ob odprtju izmene vnese svoj ID/PIN; strežnik v istem odgovoru odpre izmeno in izda actor sejo. Zaprtje izmene ne odjavi sistemske blagajne.

**Why:** Natakarji nimajo lastnih sistemskih prijav. Clerk identificira skupno blagajno, PIN pa natakarja, ki trenutno dela in izdaja račune.

**How to apply:** Osebni tok zahteva veljaven natakarjev PIN ter v eni operaciji odpre izmeno in aktivira actorja. Administratorsko odpiranje brez PIN-a nikoli ne prevzame natakarjeve identitete.

Poljubno število natakarjev sme imeti sočasno odprto izmeno na isti blagajni. Actor seja predstavlja samo trenutno osebo za terminal/dejanje; preklop med natakarji ne odpira, zapira ali spreminja njihovih izmen.

**Why:** Običajne gostinske izmene se prekrivajo, ob konicah ali velikih skupinah pa lahko na isti blagajni po potrebi dela poljubno število natakarjev.

**How to apply:** QuickSwitch naj ponudi vse natakarje z odprto izmeno v aktivni enoti; uporabnik izbere ime in vnese PIN. Račun pripiši izbranemu actorju in njegovi odprti izmeni.

Če je natakar že izbran na računu, actor potrditev ne sme ponovno zahtevati izbire. QuickSwitch prevzame izbrani ID in zahteva samo njegov PIN; drugačna obstoječa actor seja se zavrže.

**Why:** Ponovna izbira istega natakarja pri izdaji računa je odvečen korak in poveča možnost napačne pripisave.

**How to apply:** Pred actor pozivom sinhroniziraj izbrani ID računa v QuickSwitch; veljavno obstoječo sejo sprejmi samo, če pripada istemu natakarju.

Menjava natakarja pri računu je transakcijska: nova izbira je nepotrjen predlog, dokler PIN ni uspešen. Napačen PIN ali preklic ohranita prejšnjega natakarja in actor sejo; brez prejšnjega ostane »Brez natakarja«.

**Why:** Zapis novega ID-ja pred preverjanjem PIN-a omogoči, da račun ostane pripisan nepreverjenemu natakarju.

**How to apply:** Med PIN dialogom ne spreminjaj potrjenega operator ID-ja ali starega actor žetona. Ob uspehu ju zamenjaj skupaj; ob preklicu obnovi zadnji potrjeni ID.

Potekla ali pokvarjena actor seja ne sme blokirati običajnih POS poti, kot je odpiranje naročila; obravnava se kot manjkajoč actor. Samo občutljiva dejanja zahtevajo novo PIN potrditev.

**Why:** Android/PWA lahko po restartu obdrži star sessionStorage žeton; globalni 401 bi po nepotrebnem onesposobil celotno blagajno.

**How to apply:** Actor middleware naj napako shrani v request kontekst in nadaljuje; obvezni actor guard jo spremeni v 401 samo na zaščitenih poteh.

AI sme na zahtevo odpreti samo izmeno natakarja iz veljavne actor seje. Ime ali ID iz glasovnega ukaza oziroma request bodyja nikoli ne določa identitete.

**Why:** ID+PIN že vzpostavita kratkotrajno podpisano identiteto; ponovno ugibanje po imenu je manj zanesljivo, zaupanje odjemalčevemu ID-ju pa bi omogočilo odprtje izmene drugi osebi.

**How to apply:** Način »moja izmena« naj actor ID razreši izključno strežnik in nato uporabi isti transakcijski servis, Z-kontrole ter kadrovski audit kot ročni tok. Brez actor seje mora odpovedati zaprto.

Odklep z actor PIN-om nikoli ne sme samodejno nadaljevati predhodno prekinjenega občutljivega dejanja.

**Why:** Samodejni replay po PIN-u bi dejanje izvedel brez nove izrecne uporabnikove potrditve.

**How to apply:** Po odklepu naj se UI samo odklene; uporabnik mora občutljivo dejanje znova sprožiti.

Ponovni tisk nespremenjenega izdanega računa ne zahteva actor PIN-a. Sprememba kupca ali plačilnih podatkov pa ostane občutljivo dejanje z veljavno actor sejo.

**Why:** Uporabnik je potrdil, da tisk kopije ne sme biti blokiran po izteku natakarjeve seje. Tisk ni nova izdaja računa in ne sme neopaženo spreminjati že izdanih poslovnih podatkov.

**How to apply:** Loči tisk od popravka; pri nespremenjenih podatkih sploh ne pošiljaj zahteve za spremembo. Ne odstranjuj zaščite na mutacijah, da bi omogočil kopije. Prijava blagajne, dostop do enote in evidenca kopij ostanejo veljavni.