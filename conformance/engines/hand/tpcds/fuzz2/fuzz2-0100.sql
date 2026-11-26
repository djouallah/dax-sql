-- ADDCOLUMNS: only the measures see the promotion name (context transition). m0: the overall average store
-- quantity over the name's distinct store customers, over its catalog quantity YoY (all dates against every
-- date a year back). m1: category is not grouped: the name's catalog profit of the date table's last year.
WITH y AS (SELECT MAX(d_date) AS mx FROM date_dim),
ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
s AS (
  SELECT p.p_promo_name, COUNT(DISTINCT ss.ss_customer_sk) + (COUNT(*) > COUNT(ss.ss_customer_sk))::INT AS cust
  FROM store_sales ss LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk GROUP BY 1),
c AS (
  SELECT p.p_promo_name, SUM(cs.cs_quantity) AS q,
    SUM(cs.cs_quantity) FILTER (WHERE d.d_date IN (SELECT dt FROM ly)) AS qly,
    SUM(cs.cs_net_profit) FILTER (WHERE d.d_date BETWEEN date_trunc('year', y.mx) AND y.mx) AS ytd
  FROM catalog_sales cs LEFT JOIN promotion p ON p.p_promo_sk = cs.cs_promo_sk
  LEFT JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk, y
  GROUP BY 1),
a AS (SELECT AVG(ss_quantity) AS a FROM store_sales)
SELECT n.p_promo_name,
  (a.a / NULLIF(s.cust, 0)) / NULLIF(COALESCE((COALESCE(c.q, 0) - c.qly)::DOUBLE / NULLIF(c.qly, 0), 0), 0) AS m0,
  c.ytd AS m1
FROM (SELECT DISTINCT p_promo_name FROM promotion) n CROSS JOIN a
LEFT JOIN s ON s.p_promo_name IS NOT DISTINCT FROM n.p_promo_name
LEFT JOIN c ON c.p_promo_name IS NOT DISTINCT FROM n.p_promo_name
