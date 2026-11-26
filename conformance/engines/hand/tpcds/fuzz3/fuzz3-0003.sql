SELECT
  (SELECT abs(SUM(cs_quantity)) FROM catalog_sales) AS m0,
  (SELECT length(left(upper(COALESCE(string_agg(COALESCE(sm_type, ''), '|' ORDER BY sm_type NULLS FIRST), '')), 5)) FROM (SELECT DISTINCT sm_type FROM ship_mode)) AS m1,
  (SELECT abs(SUM(cs_ext_sales_price)) FROM catalog_sales) AS m2
