-- each promotion name's revenue over the last year of the calendar (YTD at its last date), averaged
-- over the names that have any; a blank name holds the sales with no promotion too
WITH ytd AS (
  SELECT d_date_sk_1 FROM date_dim
  WHERE d_date BETWEEN (SELECT date_trunc('year', MAX(d_date)) FROM date_dim) AND (SELECT MAX(d_date) FROM date_dim)
), r AS (
  SELECT p.p_promo_name, SUM(ss.ss_ext_sales_price) AS rev
  FROM store_sales ss
  LEFT JOIN promotion p ON p.p_promo_sk = ss.ss_promo_sk
  WHERE ss.ss_sold_date_sk IN (SELECT d_date_sk_1 FROM ytd)
  GROUP BY 1
)
SELECT AVG(r.rev)
FROM (SELECT DISTINCT p_promo_name FROM promotion) g
JOIN r ON r.p_promo_name IS NOT DISTINCT FROM g.p_promo_name
