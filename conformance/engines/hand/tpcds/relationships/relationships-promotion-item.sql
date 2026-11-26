WITH of_item AS (
  SELECT i.i_category, COUNT(*) AS n
  FROM promotion p LEFT JOIN item i ON i.i_item_sk = p.p_item_sk
  GROUP BY i.i_category)
SELECT c.i_category, (SELECT NULLIF(COUNT(*), 0) FROM promotion), of_item.n
FROM (SELECT DISTINCT i_category FROM item) c
LEFT JOIN of_item ON of_item.i_category IS NOT DISTINCT FROM c.i_category
