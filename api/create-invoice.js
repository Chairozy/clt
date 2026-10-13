/**
 * POST /api/create-invoice — Vercel serverless function.
 * Terima keranjang campuran (taxi + rental), hitung ulang total di server,
 * buat invoice Xendit, kembalikan { invoice_url } untuk redirect.
 *
 * Env yang dibutuhkan:
 *   XENDIT_SECRET_KEY   (wajib, pakai test key dulu: xnd_development_...)
 *   SUCCESS_URL         (opsional, redirect setelah lunas)
 *   FAILURE_URL         (opsional, redirect jika gagal/kedaluwarsa)
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

/* Allowlist harga rental per hari (rupiah). supirOnly = tanpa opsi lepas kunci. */
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

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  var today = new Date();
  var t = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  return s >= t;
}

function fail(res, code, msg) {
  res.status(code).json({ error: msg });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return fail(res, 405, "Method harus POST.");

  var secret = process.env.XENDIT_SECRET_KEY;
  if (!secret) return fail(res, 500, "XENDIT_SECRET_KEY belum diset di server.");

  var body = req.body || {};
  var customer = body.customer || {};
  var items = body.items;

  var name = String(customer.name || "").trim();
  var phone = String(customer.phone || "").replace(/[^0-9]/g, "");
  if (name.length < 3) return fail(res, 400, "Nama pemesan min. 3 huruf.");
  if (phone.length < 9 || phone.length > 15) return fail(res, 400, "No. WhatsApp tidak valid.");
  if (!Array.isArray(items) || !items.length) return fail(res, 400, "Keranjang kosong.");
  if (items.length > 50) return fail(res, 400, "Maks. 50 item per invoice.");

  var lines = [];
  var total = 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    if (!isValidDate(it.date)) return fail(res, 400, "Tanggal item #" + (i + 1) + " tidak valid/kedaluwarsa.");

    if (it.type === "taxi") {
      var unit = TAXI_PRICES[it.id];
      if (!unit) return fail(res, 400, "Rute taksi tidak dikenal: " + it.id);
      var qty = parseInt(it.qty, 10);
      if (!(qty >= 1 && qty <= 99)) return fail(res, 400, "Jumlah keberangkatan item #" + (i + 1) + " harus 1–99.");
      if (parseInt(it.unitPrice, 10) !== unit) return fail(res, 400, "Harga taksi berubah, ulangi dari keranjang.");
      total += unit * qty;
      lines.push({ name: String(it.name || it.id).slice(0, 64), quantity: qty, price: unit });
    } else if (it.type === "rental") {
      var r = RENTAL_BASE[it.id];
      if (!r) return fail(res, 400, "Unit rental tidak dikenal: " + it.id);
      var days = parseInt(it.days, 10);
      if (!(days >= 1 && days <= 365)) return fail(res, 400, "Jumlah hari item #" + (i + 1) + " harus 1–365.");
      var mode = it.mode === "supir" ? "supir" : "lepas";
      if (r.supirOnly) mode = "supir";
      var perDay = (mode === "supir" && !r.supirOnly) ? r.base + SUPIR_FEE : r.base;
      if (parseInt(it.unitPrice, 10) !== perDay) return fail(res, 400, "Harga rental berubah, ulangi dari keranjang.");
      total += perDay * days;
      lines.push({ name: (String(it.name || it.id) + " (" + mode + ", " + it.date + ")").slice(0, 64), quantity: days, price: perDay });
    } else {
      return fail(res, 400, "Tipe item #" + (i + 1) + " harus taxi/rental.");
    }
  }

  if (!(total >= 10000)) return fail(res, 400, "Total min. Rp 10.000 (Xendit).");

  var externalId = "clt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  var invoiceBody = {
    external_id: externalId,
    amount: total,
    currency: "IDR",
    description: "Cahlanang Transport — " + items.length + " item",
    customer: { given_names: name.slice(0, 64), mobile_number: "+" + (phone.startsWith("62") ? phone : "62" + phone.replace(/^0/, "")) },
    customer_notification_preference: { invoice_created: ["whatsapp"], invoice_reminder: ["whatsapp"] },
    items: lines,
    metadata: { customer_name: name, customer_phone: phone },
  };
  if (process.env.SUCCESS_URL) invoiceBody.success_redirect_url = process.env.SUCCESS_URL;
  if (process.env.FAILURE_URL) invoiceBody.failure_redirect_url = process.env.FAILURE_URL;

  var resp;
  try {
    resp = await fetch("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(secret + ":").toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(invoiceBody),
    });
  } catch (e) {
    return fail(res, 502, "Gagal menghubungi Xendit: " + e.message);
  }

  var data = await resp.json().catch(function () { return {}; });
  if (!resp.ok) {
    return fail(res, 502, "Xendit menolak: " + (data.message || resp.status));
  }
  if (!data.invoice_url) return fail(res, 502, "Xendit tidak mengembalikan invoice_url.");

  return res.status(200).json({ invoice_url: data.invoice_url, external_id: externalId, amount: total });
};
