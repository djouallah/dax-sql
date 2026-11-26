-- last year under a quarter of every year: a sale counted in the quarter of its date a year on. The blank quarter
-- (sales with no date) has no last year, and the store revenue of the sales with no date
WITH c AS (
  SELECT d.d_qoy AS q, n.d_qoy AS nq, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs
  JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  LEFT JOIN date_dim n ON n.d_date = (d.d_date + INTERVAL 1 YEAR)::DATE
  GROUP BY ALL
), cur AS (SELECT q, SUM(qty) AS v FROM c GROUP BY q),
ly AS (SELECT nq AS q, SUM(qty) AS v FROM c WHERE nq IS NOT NULL GROUP BY nq),
s AS (
  SELECT d.d_qoy AS q, SUM(ss.ss_ext_sales_price) AS v
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY ALL
)
SELECT g.q, (COALESCE(cur.v, 0) - ly.v) / NULLIF(ly.v, 0) AS m0, s.v AS m1
FROM (SELECT d_qoy AS q FROM date_dim
  UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
    OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)) g
LEFT JOIN cur ON cur.q = g.q LEFT JOIN ly ON ly.q = g.q LEFT JOIN s ON s.q IS NOT DISTINCT FROM g.q
