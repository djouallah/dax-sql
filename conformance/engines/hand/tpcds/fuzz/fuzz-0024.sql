-- the ship modes reach no store sale: per ship mode type, the quarter numbers whose store revenue YoY (dates a
-- year back, date by date) is above 0, and the profit share of every item (1) rounded, over customers per
-- revenue a year back
WITH shift AS (
  SELECT d_qoy, (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT d_qoy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), a AS (
  SELECT d.d_date AS dt, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), cur AS (
  SELECT d.d_qoy, SUM(a.rev) AS rev FROM date_dim d JOIN a ON a.dt = d.d_date GROUP BY ALL
), ly AS (
  SELECT shift.d_qoy, SUM(a.rev) AS rev FROM shift JOIN a ON a.dt = shift.ly GROUP BY ALL
), q AS (
  SELECT NULLIF(COUNT(*) FILTER (WHERE (COALESCE(cur.rev, 0) - ly.rev) / NULLIF(ly.rev, 0) > 0), 0) AS n
  FROM (SELECT DISTINCT d_qoy FROM date_dim) g
  LEFT JOIN cur ON cur.d_qoy = g.d_qoy LEFT JOIN ly ON ly.d_qoy = g.d_qoy
), t AS (
  SELECT ROUND(SUM(ss_net_profit) / NULLIF(SUM(ss_net_profit), 0), 2) AS share,
    COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS customers,
    (SELECT SUM(rev) FROM a WHERE dt IN (SELECT ly FROM shift)) AS rev_ly
  FROM store_sales
)
SELECT sm.sm_type, q.n AS m0, t.share / NULLIF(t.customers / NULLIF(t.rev_ly, 0), 0) AS m1
FROM (SELECT DISTINCT sm_type FROM ship_mode) sm CROSS JOIN q CROSS JOIN t
WHERE q.n IS NOT NULL OR m1 IS NOT NULL
