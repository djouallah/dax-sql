-- per education status (m0 is never blank: every status of the dimension): 0 when catalog has no profit, else
-- its profit over the year to date of the date table's last date; the three highest (ties kept)
WITH c AS (
  SELECT cd.cd_education_status, SUM(cs.cs_net_profit) AS profit,
    SUM(cs.cs_net_profit) FILTER (WHERE d.d_date BETWEEN date_trunc('year', (SELECT MAX(d_date) FROM date_dim))::DATE
                                                 AND (SELECT MAX(d_date) FROM date_dim)) AS ytd
  FROM catalog_sales cs JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  GROUP BY ALL
), t AS (
  SELECT e.cd_education_status, CASE WHEN c.profit IS NULL THEN 0 ELSE c.ytd END AS m0
  FROM (SELECT DISTINCT cd_education_status FROM customer_demographics) e
  LEFT JOIN c ON c.cd_education_status IS NOT DISTINCT FROM e.cd_education_status
)
SELECT * FROM t WHERE m0 IS NOT NULL QUALIFY RANK() OVER (ORDER BY m0 DESC) <= 3
