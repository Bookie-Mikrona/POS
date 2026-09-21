-- 049-eracun-status-poslano-email.sql
--
-- Doda vrednost "poslano_email" v CHECK constraint za e_racun_status.
-- Migracija 048 je pozabila posodobiti constraint ob dodajanju e-poštnega kanala.
--
-- Veljavne vrednosti po tej migraciji:
--   pripravljen, poslan, poslano, poslano_email, napaka

ALTER TABLE racuni DROP CONSTRAINT IF EXISTS racuni_e_racun_status_check;

ALTER TABLE racuni
  ADD CONSTRAINT racuni_e_racun_status_check
  CHECK (e_racun_status = ANY (ARRAY[
    'pripravljen'::text,
    'poslan'::text,
    'poslano'::text,
    'poslano_email'::text,
    'napaka'::text
  ]));
