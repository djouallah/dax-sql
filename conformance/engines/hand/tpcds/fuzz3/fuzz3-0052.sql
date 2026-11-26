-- RANKX's expression has no measure (no context transition): every ship mode gets the same count,
-- so each price the catalog sold at ranks 1
SELECT DISTINCT i.i_current_price, 1 AS m0
FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
