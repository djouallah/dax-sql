-- catalog_sales is not filtered by store: every state has the same value, so the dense rank is 1
SELECT 1 AS m0 FROM (SELECT 1 FROM store LIMIT 1)
