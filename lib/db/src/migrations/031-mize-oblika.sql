-- 031: Oblika mize na tlorisu (kvadrat, pravokotnik_h, pravokotnik_v)
ALTER TABLE mize ADD COLUMN IF NOT EXISTS oblika TEXT DEFAULT 'pravokotnik_h';
