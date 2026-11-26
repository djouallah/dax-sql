-- m2: one state only (HASONEVALUE) gives the catalog quantity a year back, with no date filter
-- every year but the last
SELECT
  (SELECT SUM(cs.cs_net_profit) FROM catalog_sales cs JOIN item i ON i.i_item_sk = cs.cs_item_sk WHERE i.i_color = 'plum'),
  (SELECT NULLIF(COUNT(DISTINCT i_color) + MAX(CASE WHEN i_color IS NULL THEN 1 ELSE 0 END), 0) FROM item),
  CASE WHEN (SELECT COUNT(DISTINCT s_state) + MAX(CASE WHEN s_state IS NULL THEN 1 ELSE 0 END) FROM store) = 1 THEN
    (SELECT SUM(cs.cs_quantity) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
     WHERE d.d_year < (SELECT MAX(d_year) FROM date_dim))
  END
