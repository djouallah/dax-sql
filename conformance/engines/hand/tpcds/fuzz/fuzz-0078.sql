-- filters only (no grouping column): items not olive, billing/customer state CA or AR; the
-- promotion is not filtered by them. With no date filter a year back is every year but the last.
WITH last_year AS (SELECT MAX(d_year) AS y FROM date_dim),
c AS (
  SELECT SUM(cs.cs_quantity) AS qty, SUM(cs.cs_quantity) FILTER (WHERE d.d_year < (SELECT y FROM last_year)) AS ly
  FROM catalog_sales cs
  JOIN item i ON i.i_item_sk = cs.cs_item_sk AND (i.i_color IS NULL OR i.i_color <> 'olive')
  JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk AND ca.ca_state IN ('CA', 'AR')
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
), s AS (
  SELECT SUM(ss.ss_ext_sales_price) AS ytd
  FROM store_sales ss
  JOIN item i ON i.i_item_sk = ss.ss_item_sk AND (i.i_color IS NULL OR i.i_color <> 'olive')
  JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk AND ca.ca_state IN ('CA', 'AR')
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_year = (SELECT y FROM last_year)
), r AS (
  SELECT ABS(c.qty) AS m0,
    (SELECT NULLIF(COUNT(DISTINCT p_promo_name) + MAX(CASE WHEN p_promo_name IS NULL THEN 1 ELSE 0 END), 0) FROM promotion) / NULLIF(c.ly, 0) AS m1,
    s.ytd AS m2
  FROM c CROSS JOIN s
)
SELECT * FROM r WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
