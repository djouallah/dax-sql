-- per category: no price in scope, and one education status only if the table holds one (then the ship mode count);
-- distinct store customers (no customer counts as one)
SELECT i.i_category,
  CASE WHEN (SELECT COUNT(DISTINCT cd_education_status) + MAX(CASE WHEN cd_education_status IS NULL THEN 1 ELSE 0 END) FROM customer_demographics) = 1
       THEN (SELECT COUNT(DISTINCT sm_type) + MAX(CASE WHEN sm_type IS NULL THEN 1 ELSE 0 END) FROM ship_mode) END AS m0,
  COUNT(DISTINCT ss.ss_customer_sk) + MAX(CASE WHEN ss.ss_customer_sk IS NULL THEN 1 ELSE 0 END) AS m1
FROM store_sales ss LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
GROUP BY ALL
