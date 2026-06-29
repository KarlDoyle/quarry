// Shopping cart total calculation with discount and tax handling.
function calculateCartTotal(items, discountRate, taxRate) {
  const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const discounted = subtotal * (1 - discountRate);
  return discounted * (1 + taxRate);
}
module.exports = { calculateCartTotal };
