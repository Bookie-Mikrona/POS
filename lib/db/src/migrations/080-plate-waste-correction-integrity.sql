ALTER TABLE plate_waste_handovers
  ADD CONSTRAINT plate_waste_handovers_correction_reference_check
  CHECK (
    (entry_type = 'oddaja' AND correction_of_id IS NULL)
    OR (entry_type = 'popravek' AND correction_of_id IS NOT NULL)
  );