-- no filter: store revenue; m1 = (avg store price / max catalog quantity (a fixed decimal divided by a whole
-- number: 4 places) + distinct customers) - (distinct store names / store profit) / catalog quantity a year back
WITH shift AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS ly FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)
), s AS (
  SELECT SUM(ss_ext_sales_price) AS rev, ROUND(SUM(ss_ext_sales_price) / COUNT(ss_ext_sales_price), 4) AS avgp,
    SUM(ss_net_profit) AS profit,
    COUNT(DISTINCT ss_customer_sk) + (COUNT(*) > COUNT(ss_customer_sk))::INT AS customers
  FROM store_sales
), c AS (
  SELECT MAX(cs_quantity) AS maxq, MIN(cs_net_profit) AS minp FROM catalog_sales
), ly AS (
  SELECT SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  WHERE d.d_date IN (SELECT ly FROM shift)
), st AS (
  SELECT NULLIF(COUNT(DISTINCT s_store_name) + (COUNT(*) > COUNT(s_store_name))::INT, 0) AS names FROM store
)
SELECT s.rev AS m0,
  COALESCE(ROUND(s.avgp / NULLIF(c.maxq, 0), 4), 0) + COALESCE(s.customers, 0)
    - COALESCE((st.names / NULLIF(s.profit, 0)) / NULLIF(CASE WHEN c.minp IS NULL THEN 0 ELSE ly.qty END, 0), 0) AS m1
FROM s, c, ly, st
