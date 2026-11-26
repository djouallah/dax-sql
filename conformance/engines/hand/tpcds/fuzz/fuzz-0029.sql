-- a row context filters nothing (no CALCULATE): every store, for each name
SELECT n.s_store_name, (SELECT COUNT(*) FROM store) AS m0 FROM (SELECT DISTINCT s_store_name FROM store) n
