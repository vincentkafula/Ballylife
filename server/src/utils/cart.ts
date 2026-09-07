/**
 * Cart running-total math — extracted out of the cart routes. Note this
 * is deliberately an ESTIMATE: it always assumes South Africa's 15% VAT
 * and flat shipping, since the cart is built before an address is
 * necessarily chosen. POST /orders recomputes tax properly (see
 * pricing.ts's calculateVat) once the real shipping country is known —
 * this function's `tax` and `total` are only ever shown to the customer
 * as a running estimate, never charged as-is.
 */

export interface CartItem {
  unitPrice: number;
  quantity: number;
}

export interface Coupon {
  type: "percentage" | "fixed_amount" | "free_shipping";
  value: number | string;
  max_discount_amount?: number | string | null;
}

export interface CartTotals {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  couponDiscount: number;
}

export function recalcCartTotals(items: CartItem[], coupon: Coupon | null): CartTotals {
  const subtotal = +items.reduce((s, i) => s + i.unitPrice * i.quantity, 0).toFixed(2);

  let couponDiscount = 0;
  if (coupon) {
    if (coupon.type === "percentage") {
      const maxDiscount = coupon.max_discount_amount ? Number(coupon.max_discount_amount) : Infinity;
      couponDiscount = Math.min(+(subtotal * Number(coupon.value) / 100).toFixed(2), maxDiscount);
    } else if (coupon.type === "fixed_amount") {
      couponDiscount = Math.min(Number(coupon.value), subtotal);
    }
  }

  const shipping = subtotal > 500 || coupon?.type === "free_shipping" ? 0 : (items.length ? 99 : 0);
  const tax = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + shipping + tax - couponDiscount).toFixed(2);

  return { subtotal, shipping, tax, total, couponDiscount };
}
