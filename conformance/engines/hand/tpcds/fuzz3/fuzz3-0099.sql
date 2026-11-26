-- per quarter (d_qoy): catalog quantity YTD at the quarter's last date (Jan 1 of its year through it); the two smallest
WITH g AS (SELECT d_qoy, MAX(d_date) AS hi FROM date_dim GROUP BY ALL), t AS (
  SELECT g.d_qoy, SUM(cs.cs_quantity) AS m0
  FROM g JOIN date_dim d ON d.d_date BETWEEN date_trunc('year', g.hi) AND g.hi
  JOIN catalog_sales cs ON cs.cs_sold_date_sk = d.d_date_sk_1
  GROUP BY ALL
)
SELECT * FROM t WHERE m0 IS NOT NULL QUALIFY RANK() OVER (ORDER BY m0) <= 2
