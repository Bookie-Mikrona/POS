---
name: Bookie Old preslikava glavne knjige
description: Računovodska semantika starega izvoza pri uvozu v novo glavno knjigo.
---

Pri zgodovinskem uvozu Bookie Old mora kontni plan določati oznaka **na vsaki posamezni knjižbi**, ne en sam plan za cel izvoz. Za knjiženje v novi GK so relevantne samo vrstice, ki označujejo **K2**; ime konta se nato bere iz šifranta K2, ne K1 ali K3. Ista številka konta v novem ERP ne zagotavlja istega pomena: stari konto za plačilo z Eurocard ima na primer v novem planu pomen tujega dobavitelja. Prazno polje partnerja zato samo po sebi ni dokaz manjkajočega podatka; preveri pomen starega konta, vrsto temeljnice in naravo otvoritvenih zbirnih vrstic.

**Why:** Uporabnik je potrdil pomen oznake plana na vrstici in pojasnil vrste temeljnic: 00 otvoritev, 01 blagajna, 10 bančni izpisek, 30 prejeti računi, 32 obračun DDV, 40 poraba, 60 izdani računi. Sklepanje o manjkajočih partnerjih po pravilih *novih* istošifriranih kontov je dalo napačen alarm.

**How to apply:** Pred uvozom filtriraj knjižbe po njihovem dejanskem planu in pripravi/potrdi preslikavo po nazivu in poslovnem pomenu K2; šele nato ocenjuj obvezne analitike po ciljnem kontu. Pred letom 2020 ne prenašaj široke zgodovine: pomembne so le postavke, ki so **dejansko še odprte**. Ne sklepaj o tem zgolj iz nenulskega ostanka: pri starejših vrsticah se valuta in pomen polj razlikujeta; preveri Zapiranje ter otvoritev, da stanj ne podvojiš. Datoteka Zapiranje povezuje števec prve in druge vrstice Glavne knjige ter znesek zapiranja; večina povezav je zapisana v obeh smereh, zato je ne štej kot dve plačili. Ne izgubi izvornih števcev in ne ugibaj manjkajočih vezi.

Za stare konte s predlagano ciljno šifro uporabnik želi sprejeti predlog; za konte brez predloga želi v kontni plan vnesti izvorno šifro in naziv. **Why:** Samo tako bo celoten uporabljen kontni nabor možno preslikati, vendar imajo nekatere izvorne šifre v trenutnem kontnem planu že drug pomen. **How to apply:** Pred zapisom preveri kolizije po šifri; preimenovanje obstoječega konta ni enako dodajanju in zahteva izrecno odločitev glede vpliva na obstoječe nastavitve in poročila.

Pri kolizijah je uporabnik izbral **ohraniti obstoječe konte in za stare izbrati druge šifre**, ne prepisovati obstoječih. **Why:** Enaka sedemmestna šifra v različnih planih ni zanesljiv dokaz istega poslovnega pomena; prepis bi spremenil obstoječi kontni plan. **How to apply:** Izberi prosto bližnjo sedemmestno šifro znotraj iste trimestne skupine in vedno ohrani izrecno sled izvorna → ciljna šifra. Pred dejanskim knjiženjem uporabi to preslikavo, ne samodejnega ujemanja po stari šifri.

Otvoritvene temeljnice vsebujejo zbirne salde brez partnerjev; posamezne dejansko odprte postavke je treba iskati na izvirnih letih in izvirnih temeljnicah ter preveriti zapiranja. Mikrona ne uporablja stroškovnih mest, zato prazna stroškovna mesta na uvoženih vrsticah niso manjkajoči poslovni podatki; obveznost v ciljnem kontnem planu je konfiguracijsko neskladje, ne razlog za izmišljanje dimenzij.

**Why:** Uporabnik je izrecno popravil napačno interpretacijo otvoritvenih zbirnih knjižb in poročila, ki je privzete nastavitve kontov zamenjalo za manjkajoče zgodovinske podatke.

**How to apply:** Ne dodeljuj partnerjev na otvoritvenih agregatih in ne izpeljuj saldakontov iz njih; rešuj stare odprte postavke v originalnih letih s sledjo zapiranj. Pred knjiženjem uskladi validacijo ciljnih kontov s podjetjem brez stroškovnih mest, ne dopolnjuj jih umetno.

Stari izvozi glavne knjige in prometa niso nadomestilo za izvirne prejete/izdane račune ali bančne izpiske. Uporabnik je odobril uvoz **vseh K2 temeljnic 2020–2026 le kot osnutke GK**, vključno z neuravnoteženimi temeljnicami tekočega leta; ničesar ne uravnoteži umetno in osnutkov ne knjiži avtomatično. **Why:** Tekoče leto je še v knjiženju; izvor nima popolnih računskih postavk in bančnih izpiskov, niti stroškovnih mest, ki jih zahtevajo nekateri ciljni konti. **How to apply:** Loči prenos GK od poznejšega uvoza izvirnih listin, ohrani identiteto vsakega vira ter preveri manjkajoče dimenzije pred knjiženjem.

Ne trdi, da izvoz Promet nima številk računov: polje **Stevilka1** je izpolnjeno pri vseh opazovanih prejetih in izdanih računih. Pri prejetih je videti kot dobaviteljeva številka, pri izdanih kot zaporedna številka; pri banki je lahko številka izpiska. **Why:** Prazni polji Dokument1/Dokument2 sta zavajajoči in sta povzročili preveč kategorično oceno manjkajočih podatkov. **How to apply:** Loči glavo/finančni povzetek, ki ga je morda mogoče rekonstruirati, od neobstoječih izvirnih postavk, preverjenega DDV pomena, plačilne sledi in dokazila izvirnega dokumenta.

Več starih šifer partnerjev lahko nosi isto davčno številko, tudi pod različnimi nazivi. **Why:** Ciljna baza zahteva edinstveno davčno številko na podjetje, zato ločen vnos vseh starih šifer odpove. **How to apply:** Pri GK osnutkih jih poveži na enega davčnega zavezanca, na vsaki knjižbeni vrstici pa ohrani zgodovinsko staro šifro in naziv; ne spreminjaj ali združuj izvirnih dokumentov na podlagi ugibanja.

Pri časovnem preseku zgodovinskih zapiranj **sourceAsOf ni datum zaprtja**: označuje dan izdelave posnetka. Datum posamezne povezave je v dokazilu Zapiranje zapisan kot `recordedDate` v obliki mesec/dan/leto (M/D/YYYY), ne kot slovenski dan/mesec/leto.

**Why:** Naknadno pridobljen posnetek vsebuje tudi mnogo starejša zapiranja. Filtriranje po datumu posnetka bi v prejšnjih letih napačno prikazalo že poravnane račune kot odprte.

**How to apply:** Za saldakontni izpis na zgodovinski datum preverjaj datum posameznega zapiranja v dokazilu; pred uporabo kontroliraj obliko in veljavnost datuma. Ne predpostavljaj, da je trenutni seznam odprtih postavk tudi pravilen zgodovinski seznam.