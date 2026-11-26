-- groups are the dimensions' values (dax-sql's contract): no blank row, rows with a dangling key join no group
-- per education status, brand and store state: the brand's item count (dates and the rest filter no item) over
-- the profit share of the second category by descending name (the brand's profit there over every item's)
WITH c2 AS (
  SELECT i_category FROM (SELECT DISTINCT i_category FROM item) ORDER BY i_category DESC NULLS LAST LIMIT 1 OFFSET 1
), s AS (
  SELECT cd.cd_education_status AS e, i.i_brand AS b, st.s_state AS st, i.i_category AS cat, SUM(ss.ss_net_profit) AS np
  FROM store_sales ss JOIN item i ON i.i_item_sk = ss.ss_item_sk
  JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
), tot AS (
  SELECT e, st, SUM(np) AS np FROM s GROUP BY ALL
), num AS (
  SELECT e, b, st, SUM(np) AS np FROM s WHERE cat IS NOT DISTINCT FROM (SELECT i_category FROM c2) GROUP BY ALL
), n AS (
  SELECT i_brand AS b, COUNT(*) AS n FROM item GROUP BY ALL
)
SELECT num.e, num.b, num.st, n.n / NULLIF(num.np / NULLIF(tot.np, 0), 0) AS m0
FROM num JOIN tot ON tot.e IS NOT DISTINCT FROM num.e AND tot.st IS NOT DISTINCT FROM num.st
JOIN n ON n.b IS NOT DISTINCT FROM num.b
WHERE m0 IS NOT NULL
