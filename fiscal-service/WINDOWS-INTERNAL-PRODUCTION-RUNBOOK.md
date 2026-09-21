# Bookie interni produkcijski podpis — nadzorovane Windows stranke

Ta tok je namenjen samo znanim in upravljanim strankam. Certifikat
`BOOKIE INTERNAL PRODUCTION` je samopodpisan code-signing certifikat; ni javni
CA in ne zagotavlja SmartScreen ugleda. **TEST ONLY certifikat ni nikoli
združljiv s tem tokom.**

## Enkratna izdelava ključa

Na pooblaščenem Windows x64 računalniku odprite povišan PowerShell 5.1 in
zaženite:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\new-internal-signing-certificate.ps1 -OutputDirectory .\internal-signing
```

Zasebni ključ ostane v `CurrentUser\My` kot neizvozljiv CNG ključ. Datoteka
`.cer` je javna in se lahko uporabi za preverjanje. PFX se ne ustvarja
privzeto. Če je odobren šifriran offline backup, ga operator izrecno zahteva
z `-ExportPfx -PfxPath ... -PfxPassword (Read-Host -AsSecureString)` in ga
shrani v odobren trezor; geslo se nikoli ne vpiše v skripto, git, ZIP ali
installer.

## Gradnja in paket

Za že zgrajeni in preverjeni EXE uporabite namenski tok brez ponovne
namestitve Pythona ali PyInstallerja. Iz korena unpackanega signing kita
zaženite ta ukaz v PowerShell 5.1 na Windows x64 (thumbprint in hash sta
namerno eksplicitna):

```powershell
.\sign-prebuilt-release.ps1 -PrebuiltExePath .\Bookie-Local-Gateway-1.0.0-unsigned-win-x64.exe -Version 1.0.0 -CertificateThumbprint <BOOKIE_INTERNAL_THUMBPRINT> -PublicCertificatePath C:\BookieSigning\bookie-internal-production.cer -ExpectedInputSha256 bd25994c53d3bc1597df11e8893325c9e18b95e59fdc35ebcd2e84186079a1b2 -OutputRoot .\signed-output
```

Ukaz EXE samo preveri in podpiše; ne izvede PyInstaller builda. Rezultat je
ZIP z manifestom, podpisanim EXE, podpisanima `install.ps1` in
`verify-windows-install.ps1`, javnim certifikatom, hash datoteko ter
dokumentacijo. Podpis ne uporablja RFC3161 timestamp strežnika: interni
samopodpisani certifikat nima javnega timestamp zaupanja, zato je ta omejitev
zapisana v manifestu in je preverjanje fail-closed glede signerja/fingerprinta.

```powershell
$cert = Get-Content .\internal-signing\Bookie-Local-Gateway-BOOKIE-INTERNAL-PRODUCTION.json | ConvertFrom-Json
.\build-release.ps1 -Version 1.0.0 `
  -CertificateThumbprint $cert.thumbprint `
  -PublicCertificatePath .\internal-signing\Bookie-Local-Gateway-BOOKIE-INTERNAL-PRODUCTION.cer `
  -OutputRoot .\dist\release
```

Paket mora vsebovati samo javni `.cer`, podpisan EXE in podpisane skripte,
manifest ter dokumentacijo. Pred distribucijo preverite SHA-256 ZIP-a in
thumbprint iz manifesta. Nikoli ne kopirajte PFX ali zasebnega ključa.

Če je certifikat že ustvarjen, ga ne ustvarjajte ponovno. Za popravek zaupanja
in pripravo obstoječega certifikata za PowerShell podpis zaženite samo:

```powershell
.\new-internal-signing-certificate.ps1 -OutputDirectory C:\BookieSigning\internal-signing
```

Skripta ponovno uporabi samo en exact certifikat iz `CurrentUser\My`, preveri
njegov profil in ga po potrebi doda v `CurrentUser\Root` in
`CurrentUser\TrustedPublisher`; novega certifikata ne ustvari. Nato ponovite
zgornji `sign-prebuilt-release.ps1` ukaz.

`signtool.exe` je namenjen PE/CAT podpisom in ni varen nadomestek za podpis
PowerShell `.ps1` datotek; te še naprej podpiše
`Set-AuthenticodeSignature`. `UnknownError` pri self-signed certifikatu se
obravnava z exact javnim certifikatom v CurrentUser Root/TrustedPublisher,
ne z izklopom preverjanja.

## Prva namestitev in posodobitve

Administrator zažene `install.ps1 -ExpectedSignerThumbprint <thumbprint>`.
Installer najprej preveri manifest, subject in fingerprint javnega `.cer`,
nato ga namesti v `LocalMachine\Root` in `LocalMachine\TrustedPublisher`.
Poljubni certifikati
iz paketa niso nikoli samodejno zaupanja vredni. Ob napaki se novi trust
vnosi (ločeno evidentirani po store-u) in ostale spremembe odstranijo v
rollbacku; obstoječih vnosov installer ne odstrani. Za posodobitev je še vedno
potrebna managerjeva potrditev `-ConfirmSafeCloudRelease`.

Po namestitvi zaženite `verify-windows-install.ps1` z istim pričakovanim
thumbprintom in shranite redigiran evidence JSON. Preverite delayed start,
SCM recovery, ACL, firewall, TLS in zdravje gatewaya.

## Preklic, zamenjava in odstranitev zaupanja

Ob kompromitaciji ali rotaciji najprej pripravite nov interni certifikat na
pooblaščenem računalniku, zgradite in namestite nov paket ter preverite nov
fingerprint. Šele nato odstranite star certifikat po njegovem točnem
thumbprintu iz `LocalMachine\Root` in `LocalMachine\TrustedPublisher` na
vseh upravljanih računalnikih. Ne odstranjujte certifikata, ki ga uporablja
še aktivna namestitev; preverite oba store-a in najprej preklopite vse
pakete na nov thumbprint. TEST ONLY certifikat se odstrani ločeno in nikoli
ne služi kot fallback za interno produkcijo.