-- catalog sales know no store: unless the catalog's smallest profit passes 1000 (then its whole quantity), each
-- store name's smallest store profit; the three smallest
WITH t AS (
  SELECT st.s_store_name,
    CASE WHEN (SELECT MIN(cs_net_profit) FROM catalog_sales) > 1000 THEN (SELECT SUM(cs_quantity) FROM catalog_sales)
    ELSE MIN(ss.ss_net_profit) END AS m0
  FROM store_sales ss LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY ALL
)
SELECT * FROM t WHERE m0 IS NOT NULL QUALIFY RANK() OVER (ORDER BY m0) <= 3
