-- m1: the promotion is not in scope: the education statuses (the demographics are not filtered);
-- m2: the stores (not filtered by the item). m0: the catalog revenue over the rank of the color's
-- store YoY among its YoY in each city (with no date filter, a year back is every year but the last).
WITH last_year AS (SELECT MAX(d_year) AS y FROM date_dim),
s AS (
  SELECT i.i_color AS col, st.s_city AS city, SUM(ss.ss_ext_sales_price) AS rev,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_year < (SELECT y FROM last_year)) AS ly
  FROM store_sales ss
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1, 2
), yoy_all AS (
  SELECT col, (COALESCE(SUM(rev), 0) - SUM(ly)) / NULLIF(SUM(ly), 0) AS v FROM s GROUP BY 1
), colors AS (SELECT DISTINCT i_color AS col FROM item),
per_city AS (
  SELECT c.col, ci.city, (COALESCE(s.rev, 0) - s.ly) / NULLIF(s.ly, 0) AS v
  FROM colors c CROSS JOIN (SELECT DISTINCT s_city AS city FROM store) ci
  LEFT JOIN s ON s.col IS NOT DISTINCT FROM c.col AND s.city IS NOT DISTINCT FROM ci.city
), rk AS (
  SELECT p.col, 1 + COUNT(*) FILTER (WHERE COALESCE(p.v, 0) > COALESCE(a.v, 0)) AS r
  FROM per_city p LEFT JOIN yoy_all a ON a.col IS NOT DISTINCT FROM p.col
  GROUP BY 1
), cat AS (
  SELECT i.i_color AS col, SUM(cs.cs_ext_sales_price) AS v
  FROM catalog_sales cs LEFT JOIN item i ON i.i_item_sk = cs.cs_item_sk
  GROUP BY 1
)
SELECT c.col, ROUND(ROUND(cat.v, 2) / rk.r, 4),
  (SELECT NULLIF(COUNT(DISTINCT cd_education_status) + MAX(CASE WHEN cd_education_status IS NULL THEN 1 ELSE 0 END), 0) FROM customer_demographics),
  (SELECT NULLIF(COUNT(*), 0) FROM store)
FROM colors c
LEFT JOIN rk ON rk.col IS NOT DISTINCT FROM c.col
LEFT JOIN cat ON cat.col IS NOT DISTINCT FROM c.col
