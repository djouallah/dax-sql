-- per education status: catalog net profit x 2 + store revenue in the calendar's last year; the lowest, ties kept
WITH w AS (
  SELECT date_trunc('year', MAX(d_date))::DATE AS y0, MAX(d_date) AS y1 FROM date_dim
), cs AS (
  SELECT cd.cd_education_status AS e, SUM(cs.cs_net_profit) AS np
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), ss AS (
  SELECT cd.cd_education_status AS e, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk JOIN w ON d.d_date BETWEEN w.y0 AND w.y1
  GROUP BY ALL
), v AS (
  SELECT COALESCE(cs.e, ss.e) AS e,
    CASE WHEN cs.np IS NULL AND ss.rev IS NULL THEN NULL ELSE COALESCE(cs.np * 2, 0) + COALESCE(ss.rev, 0) END AS m0
  FROM cs FULL JOIN ss ON ss.e IS NOT DISTINCT FROM cs.e
)
SELECT e, m0 FROM v WHERE m0 IS NOT NULL
QUALIFY RANK() OVER (ORDER BY m0 ASC) <= 1
