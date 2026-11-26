-- per quarter number (ADDCOLUMNS: SUM without CALCULATE sees every row). m0: all store profit (all catalog quantity is
-- over 1000) over the catalog quantity YoY of Colorado buyers by ship modes from "NEXT DAY" up; last year = each date
-- of the quarter number a year back (a month's last day also its month's). m1: from 1 January of the quarter
-- number's last date's year to that date, the average over store names of their revenue. A sale with no (or an unknown)
-- date or store makes that table's blank row: a blank quarter number (no last year, no year to date: blank) and a
-- blank store name among those averaged
WITH lyq AS (
  SELECT DISTINCT x.d_qoy, d.d_date_sk_1 AS sk
  FROM (SELECT d_qoy, (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
        UNION SELECT d_qoy, last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)) x
  JOIN date_dim d ON d.d_date = x.dt
), c AS (
  SELECT cs.cs_sold_date_sk AS sk, cs.cs_quantity AS q
  FROM catalog_sales cs JOIN customer_address ca ON ca.ca_address_sk = cs.cs_bill_addr_sk AND ca.ca_state = 'CO'
  JOIN ship_mode sm ON sm.sm_ship_mode_sk = cs.cs_ship_mode_sk AND sm.sm_type >= 'NEXT DAY'
), a AS (
  SELECT cs.cs_sold_date_sk AS sk, cs.cs_quantity AS q FROM catalog_sales cs
), yoy AS (
  SELECT q.d_qoy,
    (COALESCE((SELECT SUM(c.q) FROM c JOIN date_dim d ON d.d_date_sk_1 = c.sk WHERE d.d_qoy = q.d_qoy), 0) - l.q) / NULLIF(l.q, 0) AS co,
    (COALESCE((SELECT SUM(a.q) FROM a JOIN date_dim d ON d.d_date_sk_1 = a.sk WHERE d.d_qoy = q.d_qoy), 0) - la.q) / NULLIF(la.q, 0) AS al
  FROM (SELECT DISTINCT d_qoy FROM date_dim
    UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
      OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))) q
  LEFT JOIN (SELECT lyq.d_qoy, SUM(c.q) AS q FROM c JOIN lyq ON lyq.sk = c.sk GROUP BY ALL) l ON l.d_qoy = q.d_qoy
  LEFT JOIN (SELECT lyq.d_qoy, SUM(a.q) AS q FROM a JOIN lyq ON lyq.sk = a.sk GROUP BY ALL) la ON la.d_qoy = q.d_qoy
), ytd AS (
  SELECT d_qoy, date_trunc('year', MAX(d_date))::DATE AS d0, MAX(d_date) AS d1 FROM date_dim GROUP BY ALL
), rn AS (
  SELECT st.s_store_name, d.d_date, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  GROUP BY ALL
), m1 AS (
  SELECT d_qoy, ROUND(AVG(rev), 4) AS m1
  FROM (SELECT ytd.d_qoy, rn.s_store_name, SUM(rn.rev) AS rev FROM ytd JOIN rn ON rn.d_date BETWEEN ytd.d0 AND ytd.d1 GROUP BY ALL)
  GROUP BY ALL
)
SELECT yoy.d_qoy,
  CASE WHEN (SELECT SUM(cs_quantity) FROM catalog_sales) > 1000 THEN (SELECT SUM(ss_net_profit) FROM store_sales) ELSE yoy.al END
    / NULLIF(yoy.co, 0) AS m0,
  m1.m1
FROM yoy LEFT JOIN m1 ON m1.d_qoy = yoy.d_qoy
