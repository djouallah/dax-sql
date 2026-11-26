-- one row: for each promotion name, the count of customer states (no CALCULATE: the same each time; neither filter
-- touches customer_address or promotion)
SELECT (SELECT COUNT(DISTINCT p_promo_name) + MAX(CASE WHEN p_promo_name IS NULL THEN 1 ELSE 0 END) FROM promotion)
     * (SELECT COUNT(DISTINCT ca_state) + MAX(CASE WHEN ca_state IS NULL THEN 1 ELSE 0 END) FROM customer_address) AS m0
