---
name: QR lokacijska aktivacija
description: Varnostna meja in pravila za omejitev javnega QR menija na fizično bližino lokala.
---

Spletna geolokacija je uporabna kot približevalna ovira, vendar je odjemalske koordinate mogoče ponarediti. Ne predstavljaj je kot kriptografski dokaz fizične prisotnosti.

**Why:** Gostov brskalnik mora poslati koordinate in navedeno natančnost; zlonameren odjemalec lahko oba podatka spremeni. Podpisana seja zaščiti nadaljnje klice, ne more pa potrditi resničnosti prvotnega GPS signala.

**How to apply:** Mejo računaj konzervativno z GPS negotovostjo, aktivacijo veži na kratkotrajno strežniško podpisano sejo ter token, mizo in napravo. Če je zahtevana odpornost proti namernemu ponarejanju, dodaj strežniško preverljiv fizični signal, na primer lokalno omrežje ali kratkoživi lokalni izziv.

Replitova artifact pot lahko vsebuje več notranjih proxy korakov; število ni stabilna varnostna meja. Zaupaj samo loopback/zasebnim proxy naslovom in za odjemalca vzemi prvi nezaupani javni naslov z desne. Interni browser tester lahko vidi samo zasebno verigo, zato z njim ni mogoče pošteno E2E potrditi javnega Wi-Fi IP-ja.

**Why:** Zaupanje enemu proxy koraku je v artifact predogledu vrnilo `127.0.0.1`, zaupanje celotnemu `X-Forwarded-For` pa bi omogočilo ponarejanje. Zunanji IP-servis lahko zaradi ločenega izhodnega proxyja pokaže drug naslov kot Bookie API.

**How to apply:** Administrator naj dovoljeni Wi-Fi IP zajame prek avtenticiranega Bookie API-ja iz POS-a, ko je povezan na omrežje lokala. Proxy logiko regresijsko preveri z javnim odjemalcem pred več zasebnimi proxyji.

BLE beaconi so bili preučeni in za zdaj opuščeni. Ne načrtuj jih kot pogoj ali privzeto rešitev za javni QR meni.

**Why:** Javni meni mora ostati uporaben neposredno v brskalniku, Web Bluetooth pa ni zanesljivo podprt na iOS in zato ne zagotavlja enotnega toka za goste.

**How to apply:** Nadaljuj z brskalniško združljivimi približevalnimi ovirami. BLE ponovno odpri le ob izrecni novi odločitvi za nativno aplikacijo ali neobvezni dodatni signal.

Administratorski gumb za preizkus ne sme biti odvisen od natančnosti GPS-a, vendar tudi ne sme ustvariti javnega obhoda v URL-ju. Predogled naj avtenticiranemu administratorju izda običajno kratkotrajno, podpisano QR sejo, vezano na token, mizo, enoto in anonimni ID istega brskalnika.

**Why:** Namizni brskalniki pogosto vrnejo premalo natančno lokacijo, zato legitimni preizkus iz administracije odpove, čeprav sta QR token in meni pravilna. Javni query parameter za obhod bi hkrati oslabil zaščito za goste.

**How to apply:** Loči skeniranje natisnjene kode od gumba »Preskusi«. Samo avtenticirana administratorska pot sme predhodno izdati napravi vezano sejo; običajni javni vstop še naprej zahteva GPS ali dovoljeni Wi-Fi.