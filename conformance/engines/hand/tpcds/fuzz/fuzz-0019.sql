-- the stores of GA and TX in the city "zz-none" (none): their states by every education status
WITH st AS (
  SELECT * FROM store WHERE s_state IN ('GA', 'TX') AND s_city = 'zz-none'
), s AS (
  SELECT st.s_state, cd.cd_education_status, MIN(ss.ss_net_profit) AS minp
  FROM store_sales ss JOIN st ON st.s_store_sk = ss.ss_store_sk
  LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = ss.ss_cdemo_sk
  GROUP BY ALL
), c AS (
  SELECT cd.cd_education_status, SUM(cs.cs_quantity) AS qty
  FROM catalog_sales cs LEFT JOIN customer_demographics cd ON cd.cd_demo_sk = cs.cs_bill_cdemo_sk
  GROUP BY ALL
), g AS (
  SELECT DISTINCT st.s_state, c.cd_education_status FROM st CROSS JOIN c
  UNION SELECT s_state, cd_education_status FROM s
)
SELECT g.s_state, g.cd_education_status, s.minp AS m0, c.qty AS m1
FROM g
LEFT JOIN s ON s.s_state = g.s_state AND s.cd_education_status IS NOT DISTINCT FROM g.cd_education_status
LEFT JOIN c ON c.cd_education_status IS NOT DISTINCT FROM g.cd_education_status
WHERE s.minp IS NOT NULL OR c.qty IS NOT NULL
