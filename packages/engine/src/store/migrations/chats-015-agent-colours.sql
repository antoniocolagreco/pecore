ALTER TABLE agents ADD COLUMN card_color TEXT NOT NULL DEFAULT '#FFFFFF';
UPDATE agents SET card_color = color WHERE color IS NOT NULL;
ALTER TABLE agents DROP COLUMN color;
ALTER TABLE agents RENAME COLUMN card_color TO color;
ALTER TABLE agents DROP COLUMN has_color;
