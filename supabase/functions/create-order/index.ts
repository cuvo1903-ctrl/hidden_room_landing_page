import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MercadoPagoConfig, Order } from "npm:mercadopago";

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
  if (!Array.isArray(value) || value.length === 0) throw new Error("El carrito esta vacio.");
  if (value.length > 30) throw new Error("El carrito contiene demasiadas lineas.");

  const quantities = new Map<string, number>();
  value.forEach((item: RequestedItem) => {
    const id = cleanText(item?.id, 100);
    const quantity = Number(item?.quantity);
    if (!id) throw new Error("Hay un producto sin id.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new Error("Hay una cantidad invalida.");
    }

    const combined = (quantities.get(id) ?? 0) + quantity;
    if (combined > 10) throw new Error("La cantidad maxima por producto es 10.");
    quantities.set(id, combined);
  });

  return quantities;
}

function paymentStatus(value: unknown) {
  return cleanText(value, 40).toLowerCase() || "pending";
}

function paymentIdFrom(orderResult: Record<string, any>) {
  const payment = orderResult.transactions?.payments?.[0];
  return String(payment?.id ?? payment?.payment_id ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const accessToken = Deno.env.get("MP_ACCESS_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!accessToken || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Mercado Pago no esta configurado." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON invalido." }, 400);
  }

  const customer = (body.customer ?? {}) as Record<string, unknown>;
  const card = (body.card ?? {}) as Record<string, any>;
  const name = cleanText(customer.name, 120);
  const email = cleanText(customer.email || card.payer?.email, 254).toLowerCase();
  const phone = cleanText(customer.phone, 30);
  if (!name || !email || !phone) {
    return json({ error: "Nombre, correo y telefono son obligatorios." }, 400);
  }
  if (!validEmail(email)) return json({ error: "El correo no es valido." }, 400);

  const token = cleanText(card.token, 200);
  const paymentMethodId = cleanText(card.payment_method_id, 80);
  const paymentType = cleanText(card.payment_type_id || "credit_card", 40);
  const installments = Number(card.installments);
  if (!token || !paymentMethodId || !Number.isInteger(installments) || installments < 1) {
    return json({ error: "Los datos de tarjeta estan incompletos." }, 400);
  }

  let requestedItems: Map<string, number>;
  try {
    requestedItems = normalizeRequestedItems(body.items);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Carrito invalido." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const authorization = req.headers.get("Authorization") ?? "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  let userId: string | null = null;
  if (bearerToken && bearerToken !== anonKey) {
    const { data: authData } = await admin.auth.getUser(bearerToken);
    userId = authData.user?.id ?? null;
  }

  const productIds = [...requestedItems.keys()];
  const { data: productRows, error: productsError } = await admin
    .from("store_products")
    .select("id, name, category, price, currency, stock, is_digital, is_active")
    .in("id", productIds);

  if (productsError) return json({ error: productsError.message }, 500);
  if (productRows?.length !== productIds.length) {
    return json({ error: "Uno o mas productos ya no estan disponibles." }, 400);
  }

  const products = productRows as StoreProduct[];
  const currencies = new Set(products.map((product) => product.currency.toUpperCase()));
  if (currencies.size !== 1) {
    return json({ error: "Todos los productos deben usar la misma moneda." }, 400);
  }

  for (const product of products) {
    const quantity = requestedItems.get(product.id) ?? 0;
    if (!product.is_active) return json({ error: `${product.name} ya no esta disponible.` }, 400);
    if (product.stock !== null && product.stock < quantity) {
      return json({ error: `No hay stock suficiente de ${product.name}.` }, 400);
    }
  }

  const currency = [...currencies][0];
  const subtotal = products.reduce((sum, product) => (
    sum + Number(product.price) * (requestedItems.get(product.id) ?? 0)
  ), 0);
  const roundedTotal = Math.round(subtotal * 100) / 100;
  const reference = `hr_${crypto.randomUUID()}`;

  const { data: storeOrder, error: storeOrderError } = await admin
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
      provider: "mercadopago",
      external_reference: reference,
    })
    .select("id")
    .single();

  if (storeOrderError || !storeOrder) {
    return json({ error: storeOrderError?.message || "No se pudo crear la orden." }, 500);
  }

  const orderItems = products.map((product) => {
    const quantity = requestedItems.get(product.id) ?? 0;
    const unitPrice = Number(product.price);
    return {
      order_id: storeOrder.id,
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price: unitPrice,
      total: Math.round(unitPrice * quantity * 100) / 100,
    };
  });

  const { error: itemsError } = await admin.from("store_order_items").insert(orderItems);
  if (itemsError) {
    await admin.from("store_orders").delete().eq("id", storeOrder.id);
    return json({ error: itemsError.message }, 500);
  }

  const { data: genericOrder, error: genericOrderError } = await admin
    .from("orders")
    .insert({
      user_id: userId,
      store_order_id: storeOrder.id,
      status: "pending",
      reference,
      provider: "mercadopago",
      amount: roundedTotal,
      currency,
      metadata: { customer: { name, email, phone } },
    })
    .select("id")
    .single();

  if (genericOrderError || !genericOrder) {
    await admin.from("store_orders").delete().eq("id", storeOrder.id);
    return json({ error: genericOrderError?.message || "No se pudo registrar la orden." }, 500);
  }

  const client = new MercadoPagoConfig({ accessToken, options: { timeout: 7000 } });
  const order = new Order(client);
  const mpBody = {
    type: "online",
    processing_mode: "automatic",
    total_amount: roundedTotal.toFixed(2),
    external_reference: reference,
    payer: { email },
    transactions: {
      payments: [{
        amount: roundedTotal.toFixed(2),
        payment_method: {
          id: paymentMethodId,
          type: paymentType,
          token,
          installments,
          statement_descriptor: "Hidden Room",
        },
      }],
    },
  };

  try {
    const mpOrder = await order.create({
      body: mpBody,
      requestOptions: { idempotencyKey: reference },
    }) as Record<string, any>;
    const providerOrderId = String(mpOrder.id ?? "");
    const providerPaymentId = paymentIdFrom(mpOrder);
    const status = paymentStatus(mpOrder.status ?? mpOrder.transactions?.payments?.[0]?.status);

    await admin.from("store_orders").update({
      provider_order_id: providerOrderId || null,
      provider_payment_id: providerPaymentId || null,
    }).eq("id", storeOrder.id);

    const { error: fulfillError } = await admin.rpc("fulfill_store_order_provider", {
      p_order_id: storeOrder.id,
      p_provider: "mercadopago",
      p_provider_order_id: providerOrderId || null,
      p_provider_payment_id: providerPaymentId || providerOrderId || reference,
      p_status: status,
      p_raw_response: mpOrder,
    });

    if (fulfillError) {
      console.error("Mercado Pago fulfillment failed", fulfillError.message);
      return json({ error: "El pago fue procesado, pero no pudo actualizarse la orden." }, 500);
    }

    return json({
      order_id: storeOrder.id,
      reference,
      provider: "mercadopago",
      provider_order_id: providerOrderId,
      payment_id: providerPaymentId,
      status,
      result: mpOrder,
    });
  } catch (error) {
    await admin.from("store_orders").update({ status: "cancelled" }).eq("id", storeOrder.id);
    console.error("Mercado Pago order error", error);
    return json({ error: "Mercado Pago rechazo la solicitud de pago." }, 502);
  }
});
