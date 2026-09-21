-- QR meni slike artiklov, korak 1/7: podatkovna podpora.
-- Varnost: nullable stolpec, brez spreminjanja ali brisanja obstoječih podatkov.
ALTER TABLE artikli
  ADD COLUMN IF NOT EXISTS slika_url TEXT;

-- Razvojni testni kandidati (ne izvajaj v produkciji; produkcija bo uporabljala
-- lastno hrambo). Trenutno se v razvojno bazo ročno vpišejo samo nekateri:
-- 1. Sendvič:
--    https://upload.wikimedia.org/wikipedia/commons/e/eb/Porchetta_sandwich_meal_deal_-_Social_Board_2025-04-01.jpg
-- 2. Pica Križišče velika:
--    https://upload.wikimedia.org/wikipedia/commons/7/7f/Corned_Beef_Sandwich_Reuben.jpeg
-- 3. Malica 1:
--    https://upload.wikimedia.org/wikipedia/commons/0/0f/Two_toast_sandwiches,_the_Fat_Duck,_November_2012.jpg
-- 4. Rezervni kandidat:
--    https://upload.wikimedia.org/wikipedia/commons/2/29/Posh_Fish_Finger_Sandwich_-_The_Library_2025-07-28.jpg
-- 5. Rezervni kandidat:
--    https://upload.wikimedia.org/wikipedia/commons/e/e2/Roast_beef_toasted_sandwich_-_photo_2.jpg