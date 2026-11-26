-- per month (all years): catalog net profit from January 1 of the month's last year through its last date
-- (or 0); the 2 highest, ties kept
WITH m AS (
  SELECT d_moy, MAX(d_date) AS last FROM date_dim GROUP BY ALL
), v AS (
  SELECT m.d_moy, COALESCE(SUM(cs.cs_net_profit), 0) AS m0
  FROM m
  LEFT JOIN date_dim d ON d.d_date BETWEEN date_trunc('year', m.last)::DATE AND m.last
  LEFT JOIN catalog_sales cs ON cs.cs_sold_date_sk = d.d_date_sk_1
  GROUP BY m.d_moy
)
SELECT * FROM v
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 2
