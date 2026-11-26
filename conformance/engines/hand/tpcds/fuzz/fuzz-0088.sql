-- the marital status is not in scope: the store profit, under marital status <> "M" (a blank one,
-- of a key with no demographics row, is not "M")
SELECT i.i_category, ca.ca_state, st.s_state, SUM(ss.ss_net_profit) AS v
FROM store_sales ss
LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
LEFT JOIN customer_address ca ON ca.ca_address_sk = ss.ss_addr_sk
LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
WHERE cd.cd_marital_status IS NULL OR cd.cd_marital_status <> 'M'
GROUP BY 1, 2, 3
HAVING SUM(ss.ss_net_profit) IS NOT NULL
