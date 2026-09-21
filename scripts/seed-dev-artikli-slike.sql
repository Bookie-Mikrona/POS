-- SAMO RAZVOJNA BAZA: ročni testni URL-ji za QR meni.
-- Namenoma ni del samodejnega migracijskega runnerja in se ne sme izvajati
-- nad produkcijsko bazo.
--
-- URL-ji so javne HTTPS slike iz Wikimedia Commons:
--   Sendvič       -> https://upload.wikimedia.org/wikipedia/commons/e/eb/Porchetta_sandwich_meal_deal_-_Social_Board_2025-04-01.jpg
--   Pica Križišče -> https://upload.wikimedia.org/wikipedia/commons/7/7f/Corned_Beef_Sandwich_Reuben.jpeg
--   Malica 1      -> https://upload.wikimedia.org/wikipedia/commons/0/0f/Two_toast_sandwiches,_the_Fat_Duck,_November_2012.jpg
--   Rezerva       -> https://upload.wikimedia.org/wikipedia/commons/2/29/Posh_Fish_Finger_Sandwich_-_The_Library_2025-07-28.jpg
--   Rezerva       -> https://upload.wikimedia.org/wikipedia/commons/e/e2/Roast_beef_toasted_sandwich_-_photo_2.jpg
--
-- IDs so vezani na trenutno razvojno bazo (enota Križišče, ID 309).
UPDATE artikli
SET slika_url = CASE id
  WHEN 109 THEN 'https://upload.wikimedia.org/wikipedia/commons/e/eb/Porchetta_sandwich_meal_deal_-_Social_Board_2025-04-01.jpg'
  WHEN 515 THEN 'https://upload.wikimedia.org/wikipedia/commons/7/7f/Corned_Beef_Sandwich_Reuben.jpeg'
  WHEN 685 THEN 'https://upload.wikimedia.org/wikipedia/commons/0/0f/Two_toast_sandwiches,_the_Fat_Duck,_November_2012.jpg'
END
WHERE enota_id = 309
  AND id IN (109, 515, 685);