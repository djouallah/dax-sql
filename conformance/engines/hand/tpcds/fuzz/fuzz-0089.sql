-- SUM sees neither the state row nor the marital row (no CALCULATE): the total profit
SELECT g.s_state,
  CASE WHEN (SELECT SUM(ss_net_profit) FROM store_sales) > 10 THEN
    (SELECT NULLIF(COUNT(DISTINCT cd_marital_status) + MAX(CASE WHEN cd_marital_status IS NULL THEN 1 ELSE 0 END), 0) FROM customer_demographics) END
FROM (SELECT DISTINCT s_state FROM store) g
