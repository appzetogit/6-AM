/**
 * Resolve a human-readable customer delivery address from order payload shapes
 * (socket offer, accept response, current-trip sync).
 */
export function resolveCustomerAddress(order) {
  if (!order) return '';

  const saved =
    order.customerAddress ||
    order.customer_address ||
    order.deliveryAddress?.formattedAddress ||
    order.deliveryAddress?.address ||
    '';

  if (String(saved).trim()) return String(saved).trim();

  const deliveryAddress = order.deliveryAddress || {};
  // Mirrors formatDeliveryAddress() in the backend's shared/geo.utils.js — the
  // flat/block prefix is what actually gets the rider to the door.
  const labelled = (label, value) => {
    const v = String(value ?? '').trim();
    return v ? `${label} ${v}` : '';
  };
  const addressParts = [
    labelled('Flat', deliveryAddress.flatNumber),
    labelled('Block', deliveryAddress.blockNumber),
    deliveryAddress.street,
    deliveryAddress.colonyName,
    deliveryAddress.additionalDetails,
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.zipCode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  return addressParts.length ? addressParts.join(', ') : '';
}

/** Open Google Maps with a searchable address (same pattern as restaurant pickup). */
export function openGoogleMapsForAddress(address) {
  const query = String(address || '').trim();
  if (!query) return false;
  window.open(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    '_blank',
  );
  return true;
}
