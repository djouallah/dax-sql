-- stores named "pri", per item class: the top catalog revenue over those stores' states (catalog revenue,
-- which no store filter reaches; blank when no store has the name) and catalog revenue
SELECT i.i_class,
  CASE WHEN EXISTS (SELECT 1 FROM store WHERE s_store_name = 'pri') THEN SUM(cs.cs_ext_sales_price) END AS m0,
  SUM(cs.cs_ext_sales_price) AS m1
FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
GROUP BY ALL
HAVING SUM(cs.cs_ext_sales_price) IS NOT NULL
