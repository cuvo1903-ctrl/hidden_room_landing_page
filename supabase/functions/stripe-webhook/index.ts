import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function verifyStripeSignature(payload: string, signatureHeader: string, secret: string) {
  const parts = signatureHeader.split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = hex(digest);
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Webhook no configurado." }, 500);
  }

  const payload = await req.text();
  const signature = req.headers.get("Stripe-Signature") ?? "";
  if (!await verifyStripeSignature(payload, signature, webhookSecret)) {
    return json({ error: "Firma de Stripe inválida." }, 400);
  }

  let event: Record<string, any>;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "Payload inválido." }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    return json({ received: true });
  }

  const session = event.data?.object;
  const orderId = String(session?.metadata?.order_id ?? "");
  if (!orderId) return json({ error: "La sesión no contiene order_id." }, 400);

  const paymentIntent = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("fulfill_store_order", {
    p_order_id: orderId,
    p_stripe_session_id: String(session.id ?? ""),
    p_stripe_payment_intent: paymentIntent,
  });

  if (error) {
    console.error("Store fulfillment failed", error.message);
    return json({ error: "No se pudo confirmar la orden." }, 500);
  }

  return json({ received: true, fulfilled: data });
});
