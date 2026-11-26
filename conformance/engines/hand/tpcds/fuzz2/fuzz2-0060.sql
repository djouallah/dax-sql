-- The dense rank of the month's catalog quantity last year among the education statuses' is 1 (the total is
-- never below a part), so m0 is the month's store profit rounded, less 1.
WITH p AS (
  SELECT d.d_moy, SUM(ss.ss_net_profit) AS p
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY 1),
g AS (SELECT DISTINCT d_moy FROM date_dim UNION SELECT d_moy FROM p),
t AS (SELECT g.d_moy, COALESCE(ROUND(p.p, 2), 0) - 1 AS m0 FROM g LEFT JOIN p ON p.d_moy IS NOT DISTINCT FROM g.d_moy)
SELECT * FROM t QUALIFY RANK() OVER (ORDER BY m0) = 1
