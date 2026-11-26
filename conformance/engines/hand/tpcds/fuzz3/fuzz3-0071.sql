-- per education status, over the dates a year back by whole years (PARALLELPERIOD -1 YEAR of every date): the
-- archive's rows pass 1, so the test is the store revenue; positive, the catalog's average profit through
-- 2025-01-10 (AVERAGE of a fixed decimal is one, to 4 places); else (the class count is never negative) the
-- catalog profit over the catalog quantity's change on the year before (whole years again)
WITH b AS (
  SELECT MAKE_DATE(MIN(d_year) - 1, 1, 1) AS lo, MAKE_DATE(MAX(d_year) - 1, 12, 31) AS hi FROM date_dim
), s AS (
  SELECT cd.cd_education_status AS e, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  JOIN b ON d.d_date BETWEEN b.lo AND b.hi
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), c AS (
  SELECT cd.cd_education_status AS e,
    ROUND(AVG(cs.cs_net_profit::DOUBLE) FILTER (WHERE d.d_date BETWEEN DATE '1999-01-01' AND DATE '2025-01-10'), 4) AS av,
    SUM(cs.cs_net_profit) FILTER (WHERE d.d_date BETWEEN b.lo AND b.hi) AS np,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date BETWEEN b.lo AND b.hi) AS q,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date BETWEEN b.lo - INTERVAL 1 YEAR AND b.hi - INTERVAL 1 YEAR) AS ly
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk CROSS JOIN b
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), t AS (
  SELECT k.e,
    CASE WHEN s.rev > 0 THEN c.av ELSE c.np / NULLIF((COALESCE(c.q, 0) - c.ly) / NULLIF(c.ly, 0), 0) END AS m0
  FROM (SELECT e FROM s UNION SELECT e FROM c) k
  LEFT JOIN s ON s.e IS NOT DISTINCT FROM k.e
  LEFT JOIN c ON c.e IS NOT DISTINCT FROM k.e
)
SELECT * FROM t WHERE m0 IS NOT NULL
