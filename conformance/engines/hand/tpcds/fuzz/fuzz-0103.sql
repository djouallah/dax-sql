-- the promotion is not filtered: one name only if the table has one, else every value is blank
WITH one AS (
  SELECT COUNT(DISTINCT p_promo_name) + MAX(CASE WHEN p_promo_name IS NULL THEN 1 ELSE 0 END) = 1 AS b FROM promotion
), f AS (
  SELECT i.i_brand AS b, st.s_state AS s, MAX(ss.ss_ext_sales_price) AS mx
  FROM store_sales ss
  LEFT JOIN item i ON i.i_item_sk = ss.ss_item_sk
  LEFT JOIN store st ON st.s_store_sk = ss.ss_store_sk
  GROUP BY 1, 2
)
SELECT sm.sm_type, f.b, f.s, f.mx
FROM (SELECT DISTINCT sm_type FROM ship_mode) sm CROSS JOIN f CROSS JOIN one
WHERE one.b AND f.mx IS NOT NULL
