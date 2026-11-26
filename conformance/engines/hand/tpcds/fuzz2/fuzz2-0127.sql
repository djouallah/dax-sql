-- items priced other than 37.82 (a blank price kept); per year (a year a year back is the year before, whole).
-- m0: the year's store profit share, all items over all items (ALLEXCEPT(item, i_brand) drops the price filter): 1.
-- m1: 0 when catalog quantity the year before over the items' store profit share is blank, else the average catalog
-- quantity. m2: catalog rows. A sale with no (or an unknown) date makes the date table's blank row: a blank year, with
-- its catalog rows (no year to date, no year before: m0 blank, m1 0)
WITH f AS (
  SELECT * FROM item WHERE i_current_price IS DISTINCT FROM 37.82
), s AS (
  SELECT d.d_year, SUM(ss.ss_net_profit) AS np, SUM(ss.ss_net_profit) FILTER (WHERE ss.ss_item_sk IN (SELECT i_item_sk FROM f)) AS npf
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), c AS (
  SELECT d.d_year, SUM(cs.cs_quantity) AS q, AVG(cs.cs_quantity) AS aq, COUNT(*) AS n
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE cs.cs_item_sk IN (SELECT i_item_sk FROM f)
  GROUP BY ALL
), t AS (
  SELECT y.d_year, s.np / NULLIF(s.np, 0) AS m0, l.q / NULLIF(s.npf / NULLIF(s.np, 0), 0) AS r, c.aq, c.n
  FROM (SELECT DISTINCT d_year FROM date_dim
    UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
      OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))) y
  LEFT JOIN s ON s.d_year = y.d_year
  LEFT JOIN c ON c.d_year IS NOT DISTINCT FROM y.d_year
  LEFT JOIN c l ON l.d_year = y.d_year - 1
)
SELECT d_year, m0,
  CASE WHEN r IS NULL OR NOT EXISTS (SELECT 1 FROM f) THEN 0 ELSE aq END AS m1, n AS m2
FROM t
WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
