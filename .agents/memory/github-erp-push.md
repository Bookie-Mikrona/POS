---
name: GitHub ERP push postopek
description: Kako pushati Replit workspace na ERP GitHub repozitorij (Replit ne more direktno, treba je Windows vmesnik)
---

# GitHub ERP push postopek

## Repozitoriji
- **POS GitHub**: `https://github.com/Bookie-Mikrona/POS.git` — origin v Replit workspace
- **ERP GitHub**: `https://github.com/Bookie-Mikrona/ERP.git` — ločen repozitorij, mirror celotnega monorepa

## Problem
Replit-ov credential helper je vezan samo na `origin` (POS). Push na ERP GitHub iz Replita ni možen direktno — vedno vrne `Invalid username or token`.

## Delujoč postopek
1. Iz Replita pushaj na POS GitHub na začasno vejo: `gitPush({ branch: "erp-source" })`
2. Na Windows v mapi `/tmp/erp-push` (ali `C:\erp-local`):
   ```
   git fetch origin
   git push erp origin/erp-source:main --force
   ```
   (`erp` remote = `https://github.com/Bookie-Mikrona/ERP.git`)

**Why:** Replit OAuth injicira token samo za `origin` remote; shell git push na drug remote ne dobi poverilnic.

## Opomba
Oba repozitorija (POS in ERP) sta identična zrcala celotnega monorepa. `artifacts/erp-web` je samo v Replit workspace history, ne v POS GitHub main.
