---
name: Native ESM nalaganje API
description: Razlika med CJS zaganjalnikom tsx in neposrednim native ESM nalaganjem v razvojnem okolju.
---

Pri spreminjanju razvojnega zaganjalnika ohrani native ESM nalaganje TypeScripta, dokler ni posebej preverjena enakovrednost drugih načinov.

**Why:** V tem okolju so CJS/CLI poskusi nalaganja istega API uvoznega grafa obstali brez napake, native ESM nalaganje pa je uspelo in obnovilo delujoči strežnik. Sam zastoj takega diagnostičnega ukaza ni dokaz napake v podatkih ali poslovni logiki.

**How to apply:** Pri uvoznih zastojih primerjaj načina nalaganja pred obsežnim spreminjanjem API. Zaganjaj en sam razvojni watcher skozi obstoječi upravljani workflow; ne ustvarjaj nadomestnega strežnika.