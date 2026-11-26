-- per month (all years): catalog net profit from January 1 of the month's last year through its last date
-- (or 0); the 2 highest, ties kept. The blank month (a sale with no or an unknown date) has no dates: 0
WITH m AS (
  SELECT d_moy, MAX(d_date) AS last FROM date_dim GROUP BY ALL
  UNION SELECT NULL, NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
), v AS (
  SELECT m.d_moy, COALESCE(SUM(cs.cs_net_profit), 0) AS m0
  FROM m
  LEFT JOIN date_dim d ON d.d_date BETWEEN date_trunc('year', m.last)::DATE AND m.last
  LEFT JOIN catalog_sales cs ON cs.cs_sold_date_sk = d.d_date_sk_1
  GROUP BY m.d_moy
)
SELECT * FROM v
QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 2
