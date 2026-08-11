// Stripe calls this automatically the moment a payment actually succeeds.
// This is the ONLY place a booking notification gets sent — so a booking
// can never be "half done": either payment succeeded and you get notified
// with everything attached, or nothing happened at all.
//
// Signature verification is done by hand with Node's built-in crypto module
// (no npm package needed) so this deploys the simple drag-and-drop way.

const crypto = require('crypto');

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing Stripe-Signature header');
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error('Malformed Stripe-Signature header');

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  if (expected !== signature) {
    throw new Error('Signature mismatch');
  }
}

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];

  try {
    verifyStripeSignature(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  const stripeEvent = JSON.parse(event.body);

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const m = session.metadata || {};
    const amountPaid = `$${(session.amount_total / 100).toFixed(2)}`;

    if (process.env.FORMSPREE_ENDPOINT) {
      try {
        await fetch(process.env.FORMSPREE_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Referer: process.env.URL || 'https://totehippo.com',
          },
          body: JSON.stringify({
            subject: `New paid Tote Hippo booking — ${m.packageLabel || 'Unknown package'}`,
            name: m.name,
            email: session.customer_email,
            amount_paid: amountPaid,
            package: m.packageLabel,
            customer_phone: m.phone,
            delivery_address: m.address,
            delivery_date: m.deliveryDate,
            pickup_date: m.pickupDate,
            notes: m.notes,
            stripe_session_id: session.id,
            message: `New booking paid in full.\n\nPackage: ${m.packageLabel}\nAmount paid: ${amountPaid}\nName: ${m.name}\nEmail: ${session.customer_email}\nPhone: ${m.phone}\nDelivery address: ${m.address}\nDelivery date: ${m.deliveryDate}\nPickup date: ${m.pickupDate}\nNotes: ${m.notes || 'none'}\nStripe session: ${session.id}`,
          }),
        });
      } catch (err) {
        console.error('Formspree notification failed:', err);
        // Don't fail the webhook over a notification hiccup — the payment
        // already succeeded, and Stripe would otherwise keep retrying this.
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
