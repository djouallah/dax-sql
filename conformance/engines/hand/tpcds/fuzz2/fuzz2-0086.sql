-- ship_mode does not filter store_sales: every ship type x quarter. m1: TOTALYTD from the quarter's last date
-- (of the date table's years: its last year), the year to that date, outside class 'fiction' and state 'CO'
-- (blanks kept). m2: HASONEVALUE(i_category) holds only when item has a single category.
WITH one AS (SELECT COUNT(DISTINCT i_category) + (COUNT(*) > COUNT(i_category))::INT = 1 AS b FROM item),
q AS (
  SELECT d.d_qoy, MAX(ss.ss_quantity) AS mq, SUM(ss.ss_quantity) AS sq
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY 1),
lq AS (SELECT d_qoy, MAX(d_date) AS mx FROM date_dim GROUP BY 1),
a AS (
  SELECT d.d_date AS dt, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
  WHERE i.i_class IS DISTINCT FROM 'fiction' AND ca.ca_state IS DISTINCT FROM 'CO'
  GROUP BY 1),
ytd AS (
  SELECT lq.d_qoy, SUM(a.rev) AS rev FROM lq JOIN a ON a.dt BETWEEN date_trunc('year', lq.mx) AND lq.mx GROUP BY 1)
SELECT sm.sm_type, g.d_qoy, q.mq AS m0, ytd.rev AS m1, CASE WHEN one.b THEN q.sq END AS m2
FROM (SELECT DISTINCT sm_type FROM ship_mode) sm, (SELECT DISTINCT d_qoy FROM date_dim) g, one
LEFT JOIN q ON q.d_qoy IS NOT DISTINCT FROM g.d_qoy LEFT JOIN ytd ON ytd.d_qoy IS NOT DISTINCT FROM g.d_qoy
WHERE q.mq IS NOT NULL OR ytd.rev IS NOT NULL OR (one.b AND q.sq IS NOT NULL)
