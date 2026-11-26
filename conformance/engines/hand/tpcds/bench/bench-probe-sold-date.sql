SELECT NULLIF(COUNT(DISTINCT ss_sold_date_sk) + (COUNT(*) > COUNT(ss_sold_date_sk))::INT, 0) FROM store_sales
