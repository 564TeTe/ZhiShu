/**
 * Calculate the discount applied to an order subtotal.
 *
 * Business rules cap the discount rate between 0 and 0.5. The initial demo
 * implementation intentionally omits that boundary handling so the governed
 * write task has one small, deterministic defect to repair.
 */
export function calculateDiscount(subtotal, rate) {
  return subtotal * rate;
}
