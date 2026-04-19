-- ============================================================
-- WareCore WMS - Seed Data
-- Run AFTER migrations
-- ============================================================

-- ============================================================
-- MATERIAL TYPES
-- ============================================================
INSERT INTO material_types (name, unit, description) VALUES
  ('CR Coil', 'tons', 'Cold Rolled Coil'),
  ('GI Coil', 'tons', 'Galvanized Iron Coil'),
  ('GA Coil', 'tons', 'Galvannealed Coil'),
  ('HR Coil', 'tons', 'Hot Rolled Coil'),
  ('Paint', 'units', 'Paint material'),
  ('Scrap', 'tons', 'Steel scrap'),
  ('Channels', 'tons', 'Steel Channels'),
  ('Sheets', 'tons', 'Steel Sheets'),
  ('Custom Fabrication', 'units', 'Custom fabricated products');

-- ============================================================
-- MATERIAL SIZES (for CR Coil)
-- ============================================================
INSERT INTO material_sizes (material_type_id, size_label, thickness, width)
SELECT id, '0.80x121', 0.80, 121 FROM material_types WHERE name = 'CR Coil'
UNION ALL
SELECT id, '0.80x1000', 0.80, 1000 FROM material_types WHERE name = 'CR Coil'
UNION ALL
SELECT id, '1.00x1000', 1.00, 1000 FROM material_types WHERE name = 'CR Coil'
UNION ALL
SELECT id, '1.20x1250', 1.20, 1250 FROM material_types WHERE name = 'CR Coil'
UNION ALL
SELECT id, '1.40x1165', 1.40, 1165 FROM material_types WHERE name = 'CR Coil'
UNION ALL
SELECT id, '1.60x1250', 1.60, 1250 FROM material_types WHERE name = 'CR Coil'
UNION ALL
SELECT id, '2.00x1250', 2.00, 1250 FROM material_types WHERE name = 'CR Coil'
UNION ALL
SELECT id, 'Over Width', NULL, NULL FROM material_types WHERE name = 'CR Coil';

-- ============================================================
-- SAMPLE COMPANIES (update with real data)
-- ============================================================
INSERT INTO companies (name, code, address, gstin) VALUES
  ('SteelCorp India Pvt Ltd', 'SCI', '123 Industrial Area, Mumbai', '27AABCS1234A1Z5'),
  ('MetalWorks Ltd', 'MWL', '45 MIDC, Pune', '27AABCM5678B2Z6'),
  ('IronTech Industries', 'ITI', '78 SEZ, Nashik', '27AABCI9012C3Z7');

-- ============================================================
-- SAMPLE WAREHOUSES
-- ============================================================
INSERT INTO warehouses (company_id, name, address)
SELECT id, 'Main Warehouse', 'Gate 1, Mumbai' FROM companies WHERE code = 'SCI'
UNION ALL
SELECT id, 'Secondary Warehouse', 'Gate 2, Mumbai' FROM companies WHERE code = 'SCI'
UNION ALL
SELECT id, 'Main Warehouse', 'MIDC, Pune' FROM companies WHERE code = 'MWL'
UNION ALL
SELECT id, 'Main Warehouse', 'SEZ, Nashik' FROM companies WHERE code = 'ITI';
