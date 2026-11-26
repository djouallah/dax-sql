-- m0: marital status is not grouped. m1: RANKX of an AVERAGE (no context transition) is 1, less the best
-- month's store profit. m2: distinct prices over last year's revenue (all dates a year back), over the catalog
-- profit per average quantity (a fixed decimal by a number: four places).
WITH ly AS (
  SELECT (d_date - INTERVAL 1 YEAR)::DATE AS dt FROM date_dim
  UNION SELECT last_day((d_date - INTERVAL 1 YEAR)::DATE) FROM date_dim WHERE d_date = last_day(d_date)),
sply AS (
  SELECT SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_date IN (SELECT dt FROM ly)),
mo AS (
  SELECT MAX(p) AS p FROM (
    SELECT d.d_moy, SUM(ss.ss_net_profit) AS p
    FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY 1)),
c AS (SELECT MAX(cs_quantity) AS mq, SUM(cs_net_profit) AS np, AVG(cs_quantity) AS aq FROM catalog_sales),
pr AS (SELECT NULLIF(COUNT(DISTINCT i_current_price) + (COUNT(*) > COUNT(i_current_price))::INT, 0) AS n FROM item)
SELECT COALESCE(c.mq, 0) AS m0,
  1 - COALESCE(mo.p, 0) AS m1,
  (pr.n / NULLIF(sply.rev, 0)::DOUBLE) / NULLIF(ROUND(c.np / NULLIF(c.aq, 0), 4), 0) AS m2
FROM c, mo, sply, pr
