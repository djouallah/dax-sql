-- RANKX of MIN over store_sales, which no promotion row changes (no CALCULATE): all tie at 1
SELECT DISTINCT p_promo_name, 1 FROM promotion
