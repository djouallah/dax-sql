-- per store name: 0 when the chosen sales a year back are blank, else the catalog YoY of the month before the
-- date table's first date (PREVIOUSMONTH; those dates a year back); the two lowest (ties kept)
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), pm AS (
  SELECT d_date FROM date_dim
  WHERE date_trunc('month', d_date) = date_trunc('month', (SELECT MIN(d_date) FROM date_dim)) - INTERVAL 1 MONTH
), pm_ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM pm
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM pm WHERE d_date = last_day(d_date)
), c AS (
  SELECT SUM(cs.cs_ext_sales_price) AS rev,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT ly FROM shift)) AS qty_ly,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT d_date FROM pm)) AS qty_pm,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT ly FROM pm_ly)) AS qty_pm_ly
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
), s AS (
  SELECT st.s_store_name, SUM(ss.ss_ext_sales_price) AS rev_ly
  FROM store_sales ss JOIN store st ON st.s_store_sk = ss.ss_store_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk AND d.d_date IN (SELECT ly FROM shift)
  GROUP BY ALL
), t AS (
  SELECT n.s_store_name,
    CASE WHEN (CASE WHEN COALESCE(c.rev, 0) > 1000 THEN c.qty_ly ELSE s.rev_ly END) IS NULL THEN 0
      ELSE (COALESCE(c.qty_pm, 0) - c.qty_pm_ly) / NULLIF(c.qty_pm_ly, 0) END AS m0
  FROM (SELECT DISTINCT s_store_name FROM store) n CROSS JOIN c
  LEFT JOIN s ON s.s_store_name IS NOT DISTINCT FROM n.s_store_name
)
SELECT * FROM t WHERE m0 IS NOT NULL QUALIFY RANK() OVER (ORDER BY m0) <= 2
