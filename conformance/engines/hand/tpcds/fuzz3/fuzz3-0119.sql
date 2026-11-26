-- nothing filters the stores: their count (the blank row not one) for every year and brand, the blank rows' too
-- (a sale with no date; a sale or a promotion with no item)
SELECT y.d_year, b.i_brand, (SELECT NULLIF(COUNT(*), 0) FROM store) AS m0
FROM (SELECT d_year FROM date_dim
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN date_dim ON d_date_sk_1 = ss_sold_date_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN date_dim ON d_date_sk_1 = cs_sold_date_sk)) y
CROSS JOIN (SELECT i_brand FROM item
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM store_sales ANTI JOIN item ON i_item_sk = ss_item_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN item ON i_item_sk = cs_item_sk)
        OR EXISTS (SELECT 1 FROM promotion ANTI JOIN item ON i_item_sk = p_item_sk)) b
