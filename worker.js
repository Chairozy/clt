/**
 * Cloudflare Worker — backend Xendit Cahlanang Transport.
 * Satu file menggantikan folder api/ (format Vercel):
 *   POST /api/create-invoice  → buat invoice Xendit, balas { invoice_url }
 *   POST /api/xendit-webhook   → callback status dari Xendit (logging)
 *   GET  /api/health           → cek hidup
 *
 * Deploy:  wrangler deploy   (dari folder yang berisi wrangler.toml)
 * Secret:  wrangler secret put XENDIT_SECRET_KEY
 *          wrangler secret put XENDIT_CALLBACK_TOKEN   (produksi)
 */
"use strict";

var SUPIR_FEE = 200000;

/* Allowlist harga taksi (rupiah). Key = id dari frontend: taxi-<origin>-<dest> */
var TAXI_PRICES = {
  "taxi-pontianak-bandara": 100000,
  "taxi-pontianak-mempawah": 170000,
  "taxi-pontianak-singkawang": 200000,
  "taxi-pontianak-sambas": 250000,
  "taxi-pontianak-bengkayang": 200000,
  "taxi-pontianak-ngabang": 170000,
  "taxi-pontianak-sanggau": 200000,
  "taxi-pontianak-sekadau": 250000,
  "taxi-pontianak-melawi": 350000,
  "taxi-pontianak-sintang": 300000,
  "taxi-pontianak-kapuas-hulu": 500000,
  "taxi-pontianak-tayan": 150000,
  "taxi-pontianak-sandai": 300000,
  "taxi-pontianak-ketapang": 350000,
  "taxi-pontianak-sampit": 700000,
  "taxi-pontianak-pangkalan-bun": 500000,
  "taxi-pontianak-palangka-raya": 900000,
  "taxi-bandara-mempawah": 220000,
  "taxi-bandara-singkawang": 250000,
  "taxi-bandara-sambas": 300000,
  "taxi-bandara-bengkayang": 250000,
  "taxi-bandara-ngabang": 220000,
  "taxi-bandara-sanggau": 250000,
  "taxi-bandara-sekadau": 300000,
  "taxi-bandara-melawi": 400000,
  "taxi-bandara-sintang": 350000,
  "taxi-bandara-kapuas-hulu": 550000,
  "taxi-bandara-tayan": 200000,
  "taxi-bandara-sandai": 350000,
  "taxi-bandara-ketapang": 400000,
};

/* Allowlist harga rental per hari (rupiah). supirOnly = harga sudah include driver. */
var RENTAL_BASE = {
  plc1:  { base: 350000, supirOnly: false },
  plc2:  { base: 425000, supirOnly: false },
  plc3:  { base: 425000, supirOnly: false },
  plc4:  { base: 350000, supirOnly: false },
  plc5:  { base: 300000, supirOnly: false },
  plc6:  { base: 425000, supirOnly: false },
  plc7:  { base: 400000, supirOnly: false },
  plc8:  { base: 350000, supirOnly: false },
  plc9:  { base: 400000, supirOnly: false },
  plc10: { base: 400000, supirOnly: false },
  plc11: { base: 350000, supirOnly: false },
  plc12: { base: 375000, supirOnly: false },
  plc13: { base: 325000, supirOnly: false },
  plc14: { base: 300000, supirOnly: false },
  plc15: { base: 25000000, supirOnly: true },
  plc16: { base: 27000000, supirOnly: true },
  plc17: { base: 1500000, supirOnly: false },
  plc18: { base: 550000, supirOnly: false },
  plc19: { base: 4500000, supirOnly: true },
  plc20: { base: 1200000, supirOnly: false },
  plc21: { base: 600000, supirOnly: false },
  plc22: { base: 500000, supirOnly: false },
  plc23: { base: 400000, supirOnly: false },
  plc24: { base: 1500000, supirOnly: false },
  plc25: { base: 1200000, supirOnly: false },
  plc26: { base: 1400000, supirOnly: false },
  plc27: { base: 350000, supirOnly: false },
  plc28: { base: 300000, supirOnly: false },
};

function todayJakarta() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  return s >= todayJakarta();
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders()),
  });
}

function fail(msg, code) {
  return json({ error: msg }, code);
}

async function handleCreateInvoice(request, env) {
  if (request.method !== "POST") return fail("Method harus POST.", 405);

  var secret = (env && env.XENDIT_SECRET_KEY) || "";
  if (!secret) return fail("XENDIT_SECRET_KEY belum diset di server.", 500);

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return fail("Body harus JSON valid.", 400);
  }

  var customer = body.customer || {};
  var items = body.items;

  var name = String(customer.name || "").trim();
  var phone = String(customer.phone || "").replace(/[^0-9]/g, "");
  if (name.length < 3) return fail("Nama pemesan min. 3 huruf.", 400);
  if (phone.length < 9 || phone.length > 15) return fail("No. WhatsApp tidak valid.", 400);
  if (!Array.isArray(items) || !items.length) return fail("Keranjang kosong.", 400);
  if (items.length > 50) return fail("Maks. 50 item per invoice.", 400);

  var lines = [];
  var total = 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    if (!isValidDate(it.date)) return fail("Tanggal item #" + (i + 1) + " tidak valid/kedaluwarsa.", 400);

    if (it.type === "taxi") {
      var unit = TAXI_PRICES[it.id];
      if (!unit) return fail("Rute taksi tidak dikenal: " + it.id, 400);
      var qty = parseInt(it.qty, 10);
      if (!(qty >= 1 && qty <= 99)) return fail("Jumlah keberangkatan item #" + (i + 1) + " harus 1–99.", 400);
      if (parseInt(it.unitPrice, 10) !== unit) return fail("Harga taksi berubah, ulangi dari keranjang.", 400);
      total += unit * qty;
      lines.push({ name: String(it.name || it.id).slice(0, 64), quantity: qty, price: unit });
    } else if (it.type === "rental") {
      var r = RENTAL_BASE[it.id];
      if (!r) return fail("Unit rental tidak dikenal: " + it.id, 400);
      var days = parseInt(it.days, 10);
      if (!(days >= 1 && days <= 365)) return fail("Jumlah hari item #" + (i + 1) + " harus 1–365.", 400);
      var mode = it.mode === "supir" ? "supir" : "lepas";
      if (r.supirOnly) mode = "supir";
      var perDay = mode === "supir" && !r.supirOnly ? r.base + SUPIR_FEE : r.base;
      if (parseInt(it.unitPrice, 10) !== perDay) return fail("Harga rental berubah, ulangi dari keranjang.", 400);
      total += perDay * days;
      lines.push({ name: (String(it.name || it.id) + " (" + mode + ", " + it.date + ")").slice(0, 64), quantity: days, price: perDay });
    } else {
      return fail("Tipe item #" + (i + 1) + " harus taxi/rental.", 400);
    }
  }

  if (!(total >= 10000)) return fail("Total min. Rp 10.000 (Xendit).", 400);

  var externalId = "clt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  var invoiceBody = {
    external_id: externalId,
    amount: total,
    currency: "IDR",
    description: "Cahlanang Transport — " + items.length + " item",
    customer: {
      given_names: name.slice(0, 64),
      mobile_number: "+" + (phone.indexOf("62") === 0 ? phone : "62" + phone.replace(/^0/, "")),
    },
    customer_notification_preference: { invoice_created: ["whatsapp"], invoice_reminder: ["whatsapp"] },
    items: lines,
    metadata: { customer_name: name, customer_phone: phone },
  };
  if (env.SUCCESS_URL) invoiceBody.success_redirect_url = env.SUCCESS_URL;
  if (env.FAILURE_URL) invoiceBody.failure_redirect_url = env.FAILURE_URL;

  var resp;
  try {
    resp = await fetch("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(secret + ":"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(invoiceBody),
    });
  } catch (e) {
    return fail("Gagal menghubungi Xendit: " + e.message, 502);
  }

  var data = await resp.json().catch(function () { return {}; });
  if (!resp.ok) return fail("Xendit menolak: " + (data.message || resp.status), 502);
  if (!data.invoice_url) return fail("Xendit tidak mengembalikan invoice_url.", 502);

  return json({ invoice_url: data.invoice_url, external_id: externalId, amount: total });
}

async function handleWebhook(request, env) {
  if (request.method !== "POST") return fail("Method harus POST.", 405);
  var expected = (env && env.XENDIT_CALLBACK_TOKEN) || "";
  var got = request.headers.get("x-callback-token") || "";
  if (expected && got !== expected) return fail("Token callback tidak valid.", 401);
  var body = await request.json().catch(function () { return {}; });
  console.log(
    "[xendit-webhook] " +
      JSON.stringify({
        external_id: body.external_id,
        status: body.status,
        amount: body.amount,
        payment_method: body.payment_method,
        paid_at: body.paid_at,
      })
  );
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (url.pathname === "/api/create-invoice") return handleCreateInvoice(request, env || {});
    if (url.pathname === "/api/xendit-webhook") return handleWebhook(request, env || {});
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "clt-xendit" });
    }
    return fail("Not found.", 404);
  },
};
