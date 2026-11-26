-- The outer filter: every date a quarter back (a month's last day also reaching the rest of the shifted month).
-- m0 does not depend on the store: TOTALYTD from the filter's last date, its year to date against the same
-- dates a year back, of the catalog quantity for three ship types and three categories. A sale with no (or an
-- unknown) store makes the store table's blank row: a blank store name.
WITH f AS (
  SELECT dt FROM (
    SELECT (d_date - INTERVAL 3 MONTH)::DATE AS dt FROM date_dim
    UNION SELECT unnest(generate_series((d_date - INTERVAL 3 MONTH)::DATE, last_day((d_date - INTERVAL 3 MONTH)::DATE), INTERVAL 1 DAY))::DATE
    FROM date_dim WHERE d_date = last_day(d_date))
  WHERE dt IN (SELECT d_date FROM date_dim)),
ytd AS (
  SELECT d.d_date AS dt FROM date_dim d, (SELECT MAX(dt) AS mx FROM f) m
  WHERE d.d_date BETWEEN date_trunc('year', m.mx) AND m.mx),
ly AS (
  SELECT (dt - INTERVAL 1 YEAR)::DATE AS dt FROM ytd
  UNION SELECT last_day((dt - INTERVAL 1 YEAR)::DATE) FROM ytd WHERE dt = last_day(dt)),
q AS (
  SELECT d.d_date AS dt, SUM(cs.cs_quantity) AS q
  FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk JOIN item i ON i.i_item_sk = cs.cs_item_sk
  WHERE sm.sm_type IN ('REGULAR', 'TWO DAY', 'EXPRESS') AND i.i_category IN ('Books', 'Music', 'Shoes')
  GROUP BY 1),
yoy AS (
  SELECT (COALESCE(c.q, 0) - l.q)::DOUBLE / NULLIF(l.q, 0) AS v
  FROM (SELECT SUM(q) AS q FROM q WHERE dt IN (SELECT dt FROM ytd)) c,
       (SELECT SUM(q) AS q FROM q WHERE dt IN (SELECT dt FROM ly)) l),
r AS (
  SELECT s.s_store_name, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN store s ON s.s_store_sk = ss.ss_store_sk
  WHERE d.d_date IN (SELECT dt FROM f)
  GROUP BY 1)
SELECT n.s_store_name, yoy.v AS m0, r.rev AS m1
FROM (SELECT DISTINCT s_store_name FROM store
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_store_sk IS NULL OR ss_store_sk NOT IN (SELECT s_store_sk FROM store))) n
CROSS JOIN yoy
LEFT JOIN r ON r.s_store_name IS NOT DISTINCT FROM n.s_store_name
WHERE yoy.v IS NOT NULL OR r.rev IS NOT NULL
