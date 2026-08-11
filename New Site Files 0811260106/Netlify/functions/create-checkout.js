// Creates a Stripe Checkout session for the exact total computed on the booking page.
// All booking details ride along as metadata on the session, so the webhook
// can pull them back out once payment succeeds.
//
// This talks to Stripe's API directly (no npm package needed) so this whole
// site can still be deployed the simple drag-and-drop way.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const {
      packageLabel,
      totalCents,
      name,
      email,
      phone,
      address,
      deliveryDate,
      pickupDate,
      notes,
    } = data;

    if (!packageLabel || !totalCents || !email || !name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required booking fields.' }),
      };
    }

    const siteUrl = process.env.URL || 'http://localhost:8888';

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('payment_method_types[]', 'card');
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append(
      'line_items[0][price_data][product_data][name]',
      `Tote Hippo Booking — ${packageLabel}`
    );
    params.append('line_items[0][price_data][unit_amount]', String(totalCents));
    params.append('line_items[0][quantity]', '1');
    params.append('customer_email', email);
    params.append('metadata[packageLabel]', packageLabel);
    params.append('metadata[name]', name);
    params.append('metadata[phone]', phone || '');
    params.append('metadata[address]', address || '');
    params.append('metadata[deliveryDate]', deliveryDate || '');
    params.append('metadata[pickupDate]', pickupDate || '');
    params.append('metadata[notes]', notes || '');
    params.append(
      'success_url',
      `${siteUrl}/booking-success.html?session_id={CHECKOUT_SESSION_ID}`
    );
    params.append('cancel_url', `${siteUrl}/booking.html`);

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await resp.json();

    if (!resp.ok) {
      throw new Error(session.error?.message || 'Stripe error creating checkout session.');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('create-checkout error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
