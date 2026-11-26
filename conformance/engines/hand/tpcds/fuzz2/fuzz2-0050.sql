-- per store state (a sale with no store: a blank state): catalog quantity a year back (no store filter reaches
-- catalog_sales; with no date filter, every date whose next-year date is in the calendar) / store quantity;
-- the lowest, ties kept
WITH ly AS (
  SELECT SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE CAST(d.d_date + INTERVAL 1 YEAR AS DATE) IN (SELECT d_date FROM date_dim)
), v AS (
  SELECT s.s_state, (SELECT qty FROM ly) / NULLIF(SUM(ss.ss_quantity), 0) AS m0
  FROM store_sales ss LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  GROUP BY s.s_state
)
SELECT * FROM v WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 ASC) <= 1
