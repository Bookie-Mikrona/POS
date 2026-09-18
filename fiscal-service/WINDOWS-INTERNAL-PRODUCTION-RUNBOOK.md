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

## Prva namestitev in posodobitve

Administrator zažene `install.ps1 -ExpectedSignerThumbprint <thumbprint>`.
Installer najprej preveri manifest, subject in fingerprint javnega `.cer`,
nato ga namesti samo v `LocalMachine\TrustedPublisher`. Poljubni certifikati
iz paketa niso nikoli samodejno zaupanja vredni. Ob napaki se novi trust
vnos in ostale spremembe odstranijo v rollbacku. Za posodobitev je še vedno
potrebna managerjeva potrditev `-ConfirmSafeCloudRelease`.

Po namestitvi zaženite `verify-windows-install.ps1` z istim pričakovanim
thumbprintom in shranite redigiran evidence JSON. Preverite delayed start,
SCM recovery, ACL, firewall, TLS in zdravje gatewaya.

## Preklic, zamenjava in odstranitev zaupanja

Ob kompromitaciji ali rotaciji najprej pripravite nov interni certifikat na
pooblaščenem računalniku, zgradite in namestite nov paket ter preverite nov
fingerprint. Šele nato odstranite star certifikat po njegovem točnem
thumbprintu iz `LocalMachine\TrustedPublisher` na vseh upravljanih
računalnikih. Ne odstranjujte certifikata, ki ga uporablja še aktivna
namestitev. TEST ONLY certifikat se odstrani ločeno in nikoli ne služi kot
fallback za interno produkcijo.