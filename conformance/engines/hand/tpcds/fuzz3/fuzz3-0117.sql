-- store sales per price; the 3 most (blank last), then the lowest price (blank first)
WITH c AS (
  SELECT i.i_current_price AS p, COUNT(*) AS n
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk GROUP BY ALL
)
SELECT pr.p, c.n AS m0
FROM (SELECT DISTINCT i_current_price AS p FROM item) pr
LEFT JOIN c ON c.p IS NOT DISTINCT FROM pr.p
QUALIFY RANK() OVER (ORDER BY c.n DESC NULLS LAST, pr.p NULLS FIRST) <= 3
