-- per month (a row context: bare aggregates see every row, measures see the month):
-- distinct store customers x all store profit x 2 + the top store quantity over the months whose catalog
-- quantity a year back is past 10 in absolute value > 0 ?
--   (more than 1000 store sales ? all catalog quantity / the month's store revenue YoY : 1, every month sharing one average)
--   : blank (ship_mode not filtered to one type)
-- Sales of no date are date_dim's blank row, a blank month: no revenue a year back, so its YoY is blank.
WITH ly AS (
  SELECT d_date_sk_1, d_moy FROM date_dim WHERE CAST(d_date + INTERVAL 1 YEAR AS DATE) IN (SELECT d_date FROM date_dim)
), lyq AS (
  SELECT ly.d_moy, SUM(cs.cs_quantity) AS q FROM catalog_sales cs JOIN ly ON ly.d_date_sk_1 = cs.cs_sold_date_sk GROUP BY ALL
), topq AS (
  SELECT MAX(ss.ss_quantity) AS q FROM store_sales ss JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
  WHERE d.d_moy IN (SELECT d_moy FROM lyq WHERE ABS(q) > 10)
), ss AS (
  SELECT d.d_moy,
    COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS cust,
    SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss LEFT JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY ALL
), ssly AS (
  SELECT ly.d_moy, SUM(ss.ss_ext_sales_price) AS rev FROM store_sales ss JOIN ly ON ly.d_date_sk_1 = ss.ss_sold_date_sk GROUP BY ALL
), m AS (
  SELECT DISTINCT d_moy FROM date_dim
  UNION
  SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales WHERE ss_sold_date_sk IS NULL OR ss_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
    OR EXISTS (SELECT 1 FROM catalog_sales WHERE cs_sold_date_sk IS NULL OR cs_sold_date_sk NOT IN (SELECT d_date_sk_1 FROM date_dim))
), tot AS (
  SELECT (SELECT SUM(ss_net_profit) FROM store_sales) AS profit, (SELECT COUNT(*) FROM store_sales) AS n,
    (SELECT SUM(cs_quantity) FROM catalog_sales) AS qty
)
SELECT m.d_moy,
  CASE WHEN COALESCE(ss.cust * tot.profit * 2, 0) + COALESCE((SELECT q FROM topq), 0) > 0
    THEN CASE WHEN tot.n > 1000 THEN tot.qty / NULLIF((COALESCE(ss.rev, 0) - l.rev) / NULLIF(l.rev, 0), 0) ELSE 1 END
  END
FROM m CROSS JOIN tot
LEFT JOIN ss ON ss.d_moy IS NOT DISTINCT FROM m.d_moy
LEFT JOIN ssly l ON l.d_moy = m.d_moy
