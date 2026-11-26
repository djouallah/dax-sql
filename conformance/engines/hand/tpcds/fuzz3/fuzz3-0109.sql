-- RANKX of an aggregate with no measure in it: no context transition, every class ties, rank 1
SELECT DISTINCT p_promo_name, 1 AS m0 FROM promotion
