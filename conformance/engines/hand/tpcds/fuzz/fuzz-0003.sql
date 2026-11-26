-- m0: MAX(store profit, catalog quantity over an empty date range (blank) + the least catalog price);
-- a blank compares as 0 in a two-argument MAX
-- m1: no item color is >= "zz-none": blank
-- m2: no brand in scope: MAX(catalog average price (a fixed decimal: 4 places), store profit share of all items (1))
WITH a AS (
  SELECT (SELECT SUM(ss_net_profit) FROM store_sales) AS p,
         (SELECT MIN(cs_ext_sales_price) FROM catalog_sales) AS q,
         (SELECT ROUND(SUM(cs_ext_sales_price) / COUNT(cs_ext_sales_price), 4) FROM catalog_sales) AS avgp,
         (SELECT SUM(ss_net_profit) / NULLIF(SUM(ss_net_profit), 0) FROM store_sales) AS share
)
SELECT
  CASE WHEN COALESCE(p, 0) > COALESCE(q, 0) THEN p WHEN COALESCE(q, 0) > COALESCE(p, 0) THEN q ELSE COALESCE(p, q) END AS m0,
  (SELECT ABS(ROUND(SUM(ss.ss_ext_sales_price) / COUNT(ss.ss_ext_sales_price), 4)) FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
     JOIN date_dim d ON d.d_date_sk_1 = ss.ss_sold_date_sk
   WHERE i.i_color >= 'zz-none' AND d.d_date BETWEEN DATE '2026-06-03' AND DATE '2026-07-26') AS m1,
  CASE WHEN COALESCE(avgp, 0) > COALESCE(share, 0) THEN avgp WHEN COALESCE(share, 0) > COALESCE(avgp, 0) THEN share ELSE COALESCE(avgp, share) END AS m2
FROM a
