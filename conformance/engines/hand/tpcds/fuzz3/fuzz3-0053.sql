-- no item filter but the class (none): several colors, so the YTD branch is blank; a status shows 0 only when it
-- has no store profit in the quarter-shifted span of all dates (PARALLELPERIOD -1 QUARTER: whole quarters)
WITH p AS (
  SELECT date_trunc('quarter', MIN(d_date)) - INTERVAL 3 MONTH AS lo, date_trunc('quarter', MAX(d_date)) - INTERVAL 1 DAY AS hi
  FROM date_dim
), np AS (
  SELECT cd.cd_education_status AS e, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN p ON d.d_date BETWEEN p.lo AND p.hi
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
)
SELECT g.cd_education_status, 0 AS m0
FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) g
LEFT JOIN np ON np.e = g.cd_education_status
WHERE np.np IS NULL
