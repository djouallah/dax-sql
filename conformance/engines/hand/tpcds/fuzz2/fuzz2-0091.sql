-- all catalog quantity against every date a year back (a month's last day also reaching the shifted month's last)
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
c AS (
  SELECT SUM(cs.cs_quantity) AS q, SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS qly
  FROM catalog_sales cs LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk)
SELECT (COALESCE(q, 0) - qly)::DOUBLE / NULLIF(qly, 0) AS m0 FROM c
