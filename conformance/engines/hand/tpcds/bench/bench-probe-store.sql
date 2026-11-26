SELECT NULLIF(COUNT(DISTINCT ss_store_sk) + (COUNT(*) > COUNT(ss_store_sk))::INT, 0) FROM store_sales
