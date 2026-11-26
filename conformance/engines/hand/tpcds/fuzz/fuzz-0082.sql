-- A quarter's dates are every year's dates of that d_qoy. YTD: from January 1 of the year of the
-- quarter's last date to that date (every date between, the quarter's filter replaced); YTD of the
-- YTD is the same dates. A year back: each of the quarter's dates a year back (February 28 also
-- reaching February 29 when its day before is there too). The quarter and the status have their blank value
-- too when the model has that blank row (the blank quarter has no year to date and no year back).
WITH vis AS (SELECT d_qoy AS q, d_date AS d FROM date_dim),
last_d AS (SELECT q, MAX(d) AS mx FROM vis GROUP BY 1),
ytd AS (
  SELECT l.q, dd.d_date_sk_1 AS sk
  FROM last_d l JOIN date_dim dd ON dd.d_date BETWEEN date_trunc('year', l.mx) AND l.mx
),
ly AS (
  SELECT DISTINCT x.q, dd.d_date_sk_1 AS sk
  FROM (
    SELECT q, CAST(d - INTERVAL 1 YEAR AS DATE) AS d FROM vis
    UNION ALL
    SELECT v.q, CAST(v.d - INTERVAL 1 YEAR AS DATE) + 1
    FROM vis v JOIN vis p ON p.q = v.q AND p.d = v.d - 1
    WHERE month(v.d) = 2 AND day(v.d) = 28
  ) x JOIN date_dim dd ON dd.d_date = x.d
),
ss AS (
  SELECT ss.ss_sold_date_sk AS sk, cd.cd_marital_status AS m, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY 1, 2
),
s_ytd AS (SELECT ytd.q, ss.m, SUM(ss.rev) AS v FROM ytd JOIN ss ON ss.sk = ytd.sk GROUP BY 1, 2),
s_rev AS (SELECT d.d_qoy AS q, ss.m, SUM(ss.rev) AS v FROM ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.sk GROUP BY 1, 2),
cs AS (
  SELECT cs.cs_sold_date_sk AS sk, cd.cd_marital_status AS m, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY 1, 2
),
c_ly AS (SELECT ly.q, cs.m, SUM(cs.qty) AS v FROM ly JOIN cs ON cs.sk = ly.sk GROUP BY 1, 2),
g AS (
  SELECT * FROM (SELECT d_qoy AS q FROM date_dim UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim)))
  CROSS JOIN (SELECT cd_marital_status AS m FROM customer_demographics UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_cdemo_sk IS NULL OR ss_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_bill_cdemo_sk IS NULL OR cs_bill_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)
      OR cs_ship_cdemo_sk IS NULL OR cs_ship_cdemo_sk NOT IN (SELECT cd_demo_sk FROM customer_demographics)))
),
r AS (
  SELECT g.q, g.m, y.v AS m0, y.v / NULLIF(s.v, 0) AS m1, ABS(c.v) AS m2
  FROM g
  LEFT JOIN s_ytd y ON y.q IS NOT DISTINCT FROM g.q AND y.m IS NOT DISTINCT FROM g.m
  LEFT JOIN s_rev s ON s.q IS NOT DISTINCT FROM g.q AND s.m IS NOT DISTINCT FROM g.m
  LEFT JOIN c_ly c ON c.q IS NOT DISTINCT FROM g.q AND c.m IS NOT DISTINCT FROM g.m
)
SELECT * FROM r WHERE m0 IS NOT NULL OR m1 IS NOT NULL OR m2 IS NOT NULL
