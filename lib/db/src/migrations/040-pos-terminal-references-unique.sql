-- Terminalska referenca je dokazna sled enega kartičnega plačila in zato ne sme
-- nastopiti na dveh računih (tudi ne med navadnim računom in darilnim bonom).
-- PostgreSQL UNIQUE dovoljuje več NULL vrednosti, zato to ne vpliva na druge
-- plačilne načine.

CREATE UNIQUE INDEX IF NOT EXISTS racuni_sumup_checkout_id_unique
  ON racuni (sumup_checkout_id);
CREATE UNIQUE INDEX IF NOT EXISTS racuni_viva_terminal_session_id_unique
  ON racuni (viva_terminal_session_id);