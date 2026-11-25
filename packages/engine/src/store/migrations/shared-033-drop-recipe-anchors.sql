ALTER TABLE catalog_recipes DROP COLUMN has_start_ports;
ALTER TABLE catalog_recipes DROP COLUMN start_source_port;
ALTER TABLE catalog_recipes DROP COLUMN start_target_port;
ALTER TABLE catalog_recipe_edges DROP COLUMN source_port;
ALTER TABLE catalog_recipe_edges DROP COLUMN target_port;
