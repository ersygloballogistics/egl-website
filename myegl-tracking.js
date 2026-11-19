// Builds a courier tracking link from the carrier chosen in the admin portal and the tracking number.
// Returns '' when the carrier has no public tracking page (for example "Other") or the number looks unsafe.
const enc = encodeURIComponent;
const LINKS = {
  dhl: n => 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=' + enc(n),
  fedex: n => 'https://www.fedex.com/fedextrack/?trknbr=' + enc(n),
  ups: n => 'https://www.ups.com/track?loc=en_US&tracknum=' + enc(n),
  aramex: n => 'https://www.aramex.com/track/results?ShipmentNumber=' + enc(n),
  usps: n => 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + enc(n)
};
export function trackingUrl(carrier, number) {
  const n = String(number || '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9-]{4,40}$/.test(n)) return '';
  const key = String(carrier || '').toLowerCase().replace(/[^a-z]/g, '');
  return LINKS[key] ? LINKS[key](n) : '';
}
export const carrierLabel = carrier => {
  const key = String(carrier || '').toLowerCase().replace(/[^a-z]/g, '');
  return { dhl: 'DHL', fedex: 'FedEx', ups: 'UPS', aramex: 'Aramex', usps: 'USPS' }[key] || '';
};
