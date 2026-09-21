---
name: POS AI svetovalec
description: Varnostne meje za virtualnega svetovalca natakarju in kritične kontrole pred izdajo.
---

LLM sme razpoznati namen, vendar so kritične blokade in razreševanje poslovnih entitet vedno deterministična strežniška pravila nad sveže naloženim naročilom, omejenim na aktivno enoto. Predpregled ne sme zaupati odjemalčevemu posnetku ali čakati na odgovor modela.

**Why:** Plačilo in fiskalizacija sta kritična toka; zastarel ali prirejen payload ter počasen model ne smeta prikriti napake, povzročiti dvojnega plačila ali zadržati izdaje.

**How to apply:** Nova opozorila naj se razvrstijo na nasvet ali dokazljivo kritično pravilo. Kritično pravilo vključite v ločen preflight pred terminalskim plačilom in ponovno v skupno online izdajno pot; agent ne sme izvajati plačila, fiskalizacije, izdaje, vračila ali zaključka brez ločenega potrditvenega toka.

Operativni agentov spomin je omejen na neosebne delovne preference ter ločen po enoti in trajnem ID-ju natakarja. Agent sme izvesti le zaprt nabor tipiziranih operativnih dejanj, katerih ID-je strežnik enolično razreši znotraj aktivne enote in ki uporabljajo iste canonical POS endpoint-e kot običajni zaslon.

**Why:** Delno podvojena route logika je izpustila zaklep poslovnega dne, cenovna polja, alergene in sestavljena pravila, zato je varneje vrniti predlog kot izvesti nepopoln vpis.

**How to apply:** Tool schema ne sme sprejeti poljubnega dejanja ali modelskih ID-jev. Ob dvoumnem artiklu, postavki, mizi ali naročilu agent zahteva pojasnilo. Dodajanje, urejanje, brisanje, premik in združitev morajo ohraniti obstoječe tenant, KDS, zalogovne, rezervacijske in billed-line kontrole.

Delne posodobitve postavke, kot sta opomba ali gost, ne smejo ponovno zapisati količine, cene ali skupnega zneska. Ohranjene finančne vrednosti se ne smejo izračunati iz branja pred transakcijskim zaklepom.

**Why:** Sočasna metadata sprememba bi sicer lahko povrnila stare finančne vrednosti in tiho prepisala spremembo drugega natakarja.

**How to apply:** Metadata-only update zapiše samo izrecno podana polja; količino, ceno in skupaj računaj iz zaklenjene vrstice le, kadar jih zahteva finančna sprememba.

Razporejanje po hodih mora atomsko uskladiti povezane postavke in že materializirane KDS vstopnice. Dokler ni skupne atomske operacije, agent ukaz varno preda obstoječemu POS dialogu in ne sme poročati, da je hod nastavljen.

**Why:** Samostojen zapis courseSequence brez courseNumber, pairingGroupId in KDS snapshotov pokvari zaporedje sproščanja hodov.

**How to apply:** Navadne in večhodne postavke obravnavaj ločeno; povezano multicourse skupino vedno spremeni kot celoto ali dejanje zavrni.

Izrecne ukaze za navigacijo v poslovni tok (npr. naročilo na določeni mizi) razčleni deterministični parser pred LLM-jem. Vrne naj samo dovoljen intent, ki na ciljni strani pokliče isti preverjeni handler kot ročni klik. Splošni model sme navigirati le na eksplicitnem seznamu obstoječih statičnih POS poti; dinamične in neznane poti zavrni na strežniku in odjemalcu.

Deterministični resolver sme vrniti napako za artikel samo, če ukaz res vsebuje mutacijski glagol za postavko. Neprepoznano vprašanje mora vrniti `null` in nadaljevati v omejeni svetovalni tok. Bolj specifični operativni intenti in vprašanja o svežem stanju imajo prednost pred generično navigacijo nastavitev.

**Why:** Generični fallback za artikel je prestregel vsa vprašanja, nastavitev »blagajne« pa je prestregla operativni prehod na blagajno.

**How to apply:** Prioriteta je: specifično vprašanje nad svežimi tenant podatki → operativno dejanje → nastavitvena/statična navigacija → LLM explain/navigate fallback. Za vsak konflikt dodaj test z naravno slovensko sklanjatvijo.

Govorni prepis pred determinističnim razčlenjevanjem normaliziraj za Unicode/diakritiko in omejene slovnične različice. Ob zgrešenem intentu auditiraj le neosebne strukturne značilnosti, nikoli surovega prepisa.

Prosta vprašanja, ki dosežejo LLM fallback, se obdelajo pri konfiguriranem AI ponudniku šele po lokalnem odstranjevanju očitnih kontaktov, URL-jev, naslovov in imenskih vzorcev; uporabniške poti ne pošiljaj. Vmesnik mora jasno povedati, da samodejna redakcija ni popolna.

V kontekstu ukaza za nastavitve je »MIS/mis« lahko glasovni prepis slovenskega »miz« in pomeni zavihek nastavitev miz, ne ločen poslovni modul.

**Why:** Uporabnik je izrecno potrdil, da je bil »MIS« mišljen kot »nastavitve miz«.

**How to apply:** Alias uporabi samo skupaj z nedvoumnim nastavitevnim kontekstom; besede »mis« v poljubnem drugem stavku ne preslikuj na mize.

Ponavljanje zadnjega ukaza temelji na strukturiranem, neosebnem intentu iz audita, ne na shranjevanju surovega glasovnega prepisa. Ponastavitev spomina je meja, čez katero se starih ukazov ne ponavlja.

**Why:** Audit že varno hrani vrsto dejanja in nujne parametre; shranjevanje celotnega govora bi po nepotrebnem povečalo zasebnostno tveganje, brez strukturiranega ponavljanja pa agent vsak pogovor napačno obravnava kot prvega.

**How to apply:** Vsak nov ponovljiv ukaz naj dobi preverjen intent z minimalnimi parametri. Splošnemu modelu posreduj le anonimiziran povzetek nedavnih dejanj; ponovitev poslovnega dejanja vedno izvede deterministična veja.

Podpisan continuation za dvoumno poslovno dejanje mora biti kratkoživ, vezan na enoto, actorja, naročilo, ciljno entiteto in odtis dovoljenih možnosti ter enkratno porabljen v isti transakciji kot zaklenjena mutacija.

**Why:** Preverjanje podpisa in odtisa pred transakcijo samo po sebi ne prepreči, da dva sočasna odgovora z istim tokenom oba prestaneta preverjanje in drugi prepiše izbiro prvega.

**How to apply:** Token naj vsebuje naključni ID. Pod advisory lockom tega ID-ja preveri consumed marker, nato pod poslovnim zaklepom ponovno preveri podpisani odtis, izvedi mutacijo in marker zapiši pred istim commitom. Replay vedno zavrni, tudi če bi bila ponovljena mutacija idempotentna.

Pri paketnem ukazu z eno dvoumnostjo mora podpisani continuation ohraniti vse druge že razrešene dodelitve; po izbiri se celoten paket ponovno preveri in izvede kot ena atomska mutacija. Iste postavke ni dovoljeno hkrati ohraniti kot razrešene in kot dvoumne.

**Why:** Ponovno razčlenjevanje prvotnega govora bi lahko spremenilo že preverjene odločitve, posamična izvedba pred pojasnilom pa bi pustila delno stanje. Podvojena ciljna postavka bi ustvarila continuation, ki se po izbiri vedno konča v konfliktu.

**How to apply:** Paketni token podpiše preverjene numerične dodelitve, dvoumni cilj, dovoljene možnosti in odtis naročila. Pred podpisom omeji paket na največ 30 dodelitev ter zavrni več dvoumnosti ali podvojen cilj; ob nadaljevanju uporabi skupni paketni zaklep in en consumed marker.

AI audit v dejanski PostgreSQL zahteva obstoječ trajni ID natakarja, čeprav trenutna Drizzle definicija te povezave ne kaže.

**Why:** Ročna DB omejitev veže izvajalca audita na natakarja z restriktivnim brisanjem; izmišljeni actor ID zato odpove šele pri insertu.

**How to apply:** Route in integracijski testi naj vedno uporabijo resničnega natakarja istega podjetja. Audita ne zapisuj z nadomestnim ali naključnim actor ID-jem.