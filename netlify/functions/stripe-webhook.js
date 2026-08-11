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

    console.log('Webhook session data:', JSON.stringify({
      customer_email: session.customer_email,
      customer_details_email: session.customer_details?.email,
      amount_total: session.amount_total,
      metadata: m,
    }));

    if (process.env.FORMSPREE_ENDPOINT) {
      try {
        const subtotalStr = `$${((Number(m.subtotalCents) || 0) / 100).toFixed(2)}`;
        const taxStr = `$${((Number(m.taxCents) || 0) / 100).toFixed(2)}`;

        const formBody = new URLSearchParams();
        formBody.append('_subject', `New paid Tote Hippo booking — ${m.packageLabel || 'Unknown package'}`);
        formBody.append('name', m.name || '');
        formBody.append('email', session.customer_email || session.customer_details?.email || '');
        formBody.append('phone', m.phone || '');
        formBody.append('package', m.packageLabel || '');
        formBody.append('subtotal', subtotalStr);
        formBody.append('sales_tax', taxStr);
        formBody.append('total_paid', amountPaid);
        formBody.append('delivery_address', m.address || '');
        formBody.append('delivery_date', m.deliveryDate || '');
        formBody.append('pickup_date', m.pickupDate || '');
        formBody.append('notes', m.notes || 'none');
        formBody.append('stripe_session_id', session.id || '');
        formBody.append(
          'message',
          `New booking paid in full.\n\nPackage: ${m.packageLabel}\nSubtotal: ${subtotalStr}\nSales Tax: ${taxStr}\nTotal paid: ${amountPaid}\nName: ${m.name}\nEmail: ${session.customer_email}\nPhone: ${m.phone}\nDelivery address: ${m.address}\nDelivery date: ${m.deliveryDate}\nPickup date: ${m.pickupDate}\nNotes: ${m.notes || 'none'}\nStripe session: ${session.id}`
        );

        console.log('Formspree payload being sent:', formBody.toString());

        const fsResp = await fetch(process.env.FORMSPREE_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: formBody.toString(),
        });
        console.log('Formspree response status:', fsResp.status);
        const fsText = await fsResp.text();
        console.log('Formspree response body:', fsText);
      } catch (err) {
        console.error('Formspree notification failed:', err);
        // Don't fail the webhook over a notification hiccup — the payment
        // already succeeded, and Stripe would otherwise keep retrying this.
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
