SELECT NULLIF(COUNT(DISTINCT ss_item_sk) + (COUNT(*) > COUNT(ss_item_sk))::INT, 0) FROM store_sales
