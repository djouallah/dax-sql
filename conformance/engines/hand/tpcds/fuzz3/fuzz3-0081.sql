-- ADDCOLUMNS' row context filters nothing: the ship mode types joined by commas, the same length for every state.
-- The blank row (a catalog sale with no ship mode, or no address) is a value too: an empty type, a blank state
SELECT ca_state, (SELECT LENGTH(string_agg(COALESCE(sm_type, ''), ','))
  FROM (SELECT sm_type FROM ship_mode
        UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN ship_mode ON sm_ship_mode_sk = cs_ship_mode_sk))) AS m0
FROM (SELECT ca_state FROM customer_address
      UNION SELECT NULL WHERE EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_address ON ca_address_sk = cs_bill_addr_sk)
        OR EXISTS (SELECT 1 FROM catalog_sales ANTI JOIN customer_address ON ca_address_sk = cs_ship_addr_sk)
        OR EXISTS (SELECT 1 FROM store_sales ANTI JOIN customer_address ON ca_address_sk = ss_addr_sk))
