-- the archive log is related to no date: its files a quarter back are its files (blank only if it
-- has none); then the least store sales price if the stores' one state is TN, else the largest
-- catalog quantity from 1999-01-01 to 2025-03-12
WITH st AS (
  SELECT CASE WHEN COUNT(DISTINCT s_state) + MAX(CASE WHEN s_state IS NULL THEN 1 ELSE 0 END) = 1 THEN MIN(s_state) END AS state FROM store
)
SELECT CASE WHEN (SELECT COUNT(*) FROM stg_tpcds_archive_log) = 0 THEN 0
            WHEN st.state = 'TN' THEN (SELECT MIN(ss_ext_sales_price) FROM store_sales)
            ELSE (SELECT MAX(cs.cs_quantity) FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
                  WHERE d.d_date BETWEEN DATE '1999-01-01' AND DATE '2025-03-12') END AS m0
FROM st
