-- the top catalog sales price (every item, the quarters' dates) when the archive has more than 1000 files,
-- else no quarter is kept and nothing is returned
SELECT MAX(cs.cs_ext_sales_price) AS m0
FROM catalog_sales cs JOIN date_dim d ON d.d_date_sk_1 = cs.cs_sold_date_sk
WHERE (SELECT ABS(COUNT(*)) FROM stg_tpcds_archive_log) > 1000
HAVING MAX(cs.cs_ext_sales_price) IS NOT NULL
