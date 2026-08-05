import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestedItem = {
  id?: unknown;
  quantity?: unknown;
};

type StoreProduct = {
  id: string;
  name: string;
  category: string;
  price: number | string;
  currency: string;
  stock: number | null;
  is_digital: boolean;
  is_active: boolean;
  stripe_price_id: string | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeRequestedItems(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("El carrito está vacío.");
  }
  if (value.length > 30) throw new Error("El carrito contiene demasiadas líneas.");

  const quantities = new Map<string, number>();
  value.forEach((item: RequestedItem) => {
    const id = cleanText(item?.id, 100);
    const quantity = Number(item?.quantity);
    if (!id) throw new Error("Hay un producto sin id.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new Error("Hay una cantidad inválida.");
    }

    const combined = (quantities.get(id) ?? 0) + quantity;
    if (combined > 10) throw new Error("La cantidad máxima por producto es 10.");
    quantities.set(id, combined);
  });

  return quantities;
}

function appendStripeLineItem(
  params: URLSearchParams,
  index: number,
  product: StoreProduct,
  quantity: number,
) {
  // La base de datos es la autoridad de precio. stripe_price_id se conserva
  // para una futura sincronización, pero no se usa para evitar importes stale.
  params.set(`line_items[${index}][price_data][currency]`, product.currency.toLowerCase());
  params.set(
    `line_items[${index}][price_data][unit_amount]`,
    String(Math.round(Number(product.price) * 100)),
  );
  params.set(`line_items[${index}][price_data][product_data][name]`, product.name);
  params.set(
    `line_items[${index}][price_data][product_data][metadata][product_id]`,
    product.id,
  );
  params.set(
    `line_items[${index}][price_data][product_data][metadata][category]`,
    product.category,
  );
  params.set(`line_items[${index}][quantity]`, String(quantity));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const siteUrl = Deno.env.get("SITE_URL")?.replace(/\/+$/, "");

  if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey || !siteUrl) {
    return json({ error: "El checkout no está configurado." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const customer = (body.customer ?? {}) as Record<string, unknown>;
  const name = cleanText(customer.name, 120);
  const email = cleanText(customer.email, 254).toLowerCase();
  const phone = cleanText(customer.phone, 30);
  if (!name || !email || !phone) {
    return json({ error: "Nombre, correo y teléfono son obligatorios." }, 400);
  }
  if (!validEmail(email)) return json({ error: "El correo no es válido." }, 400);

  let requestedItems: Map<string, number>;
  try {
    requestedItems = normalizeRequestedItems(body.items);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Carrito inválido." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  let userId: string | null = null;

  if (token && token !== anonKey) {
    const { data: authData } = await admin.auth.getUser(token);
    userId = authData.user?.id ?? null;
  }

  const productIds = [...requestedItems.keys()];
  const { data: productRows, error: productsError } = await admin
    .from("store_products")
    .select("id, name, category, price, currency, stock, is_digital, is_active, stripe_price_id")
    .in("id", productIds);

  if (productsError) return json({ error: productsError.message }, 500);
  if (productRows?.length !== productIds.length) {
    return json({ error: "Uno o más productos ya no están disponibles." }, 400);
  }

  const products = productRows as StoreProduct[];
  const currencies = new Set(products.map((product) => product.currency.toUpperCase()));
  if (currencies.size !== 1) {
    return json({ error: "Todos los productos deben usar la misma moneda." }, 400);
  }

  for (const product of products) {
    const quantity = requestedItems.get(product.id) ?? 0;
    if (!product.is_active) return json({ error: `${product.name} ya no está disponible.` }, 400);
    if (product.stock !== null && product.stock < quantity) {
      return json({ error: `No hay stock suficiente de ${product.name}.` }, 400);
    }
  }

  const currency = [...currencies][0];
  const subtotal = products.reduce((sum, product) => (
    sum + Number(product.price) * (requestedItems.get(product.id) ?? 0)
  ), 0);
  const roundedTotal = Math.round(subtotal * 100) / 100;

  const { data: order, error: orderError } = await admin
    .from("store_orders")
    .insert({
      user_id: userId,
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      status: "pending",
      subtotal: roundedTotal,
      total: roundedTotal,
      currency,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return json({ error: orderError?.message || "No se pudo crear la orden." }, 500);
  }

  const orderItems = products.map((product) => {
    const quantity = requestedItems.get(product.id) ?? 0;
    const unitPrice = Number(product.price);
    return {
      order_id: order.id,
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price: unitPrice,
      total: Math.round(unitPrice * quantity * 100) / 100,
    };
  });

  const { error: itemsError } = await admin.from("store_order_items").insert(orderItems);
  if (itemsError) {
    await admin.from("store_orders").delete().eq("id", order.id);
    return json({ error: itemsError.message }, 500);
  }

  const params = new URLSearchParams({
    mode: "payment",
    customer_email: email,
    success_url: `${siteUrl}/store/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/store/cart.html`,
    locale: "es",
    "metadata[order_id]": order.id,
    "metadata[user_id]": userId ?? "",
    "metadata[customer_name]": name,
    "metadata[customer_phone]": phone,
  });

  products.forEach((product, index) => {
    appendStripeLineItem(params, index, product, requestedItems.get(product.id) ?? 0);
  });

  try {
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const session = await stripeResponse.json();

    if (!stripeResponse.ok || !session?.url || !session?.id) {
      await admin.from("store_orders").update({ status: "cancelled" }).eq("id", order.id);
      console.error("Stripe checkout error", session?.error?.type, session?.error?.code);
      return json({
        error: session?.error?.message || "Stripe rechazó la solicitud de checkout.",
      }, 502);
    }

    const { error: sessionUpdateError } = await admin
      .from("store_orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    if (sessionUpdateError) {
      console.error("Could not save Stripe session", sessionUpdateError.message);
      return json({ error: "La sesión se creó, pero no pudo vincularse a la orden." }, 500);
    }

    return json({ url: session.url });
  } catch (error) {
    await admin.from("store_orders").update({ status: "cancelled" }).eq("id", order.id);
    console.error("Stripe network error", error);
    return json({ error: "No se pudo conectar con Stripe." }, 502);
  }
});
