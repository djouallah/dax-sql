-- store YTD: the year of the date table's last date, up to it
WITH c AS (
  SELECT cd.cd_marital_status, SUM(cs.cs_ext_sales_price) AS rev
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), s AS (
  SELECT cd.cd_marital_status, AVG(ss.ss_quantity) AS avgq, MIN(ss.ss_net_profit) AS minp,
    SUM(ss.ss_ext_sales_price) FILTER (WHERE d.d_date BETWEEN date_trunc('year', (SELECT MAX(d_date) FROM date_dim))::DATE
                                                    AND (SELECT MAX(d_date) FROM date_dim)) AS ytd
  FROM store_sales ss
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), t AS (
  SELECT COALESCE(c.cd_marital_status, s.cd_marital_status) AS cd_marital_status, c.rev AS m0, s.avgq AS m1,
    CASE WHEN s.minp IS NOT NULL OR s.ytd IS NOT NULL THEN COALESCE(s.minp * 2, 0) + COALESCE(s.ytd, 0) END AS m2
  FROM c FULL JOIN s ON s.cd_marital_status IS NOT DISTINCT FROM c.cd_marital_status
)
SELECT * FROM t WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
