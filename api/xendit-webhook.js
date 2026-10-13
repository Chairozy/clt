/**
 * POST /api/xendit-webhook — terima callback status invoice dari Xendit.
 * Set XENDIT_CALLBACK_TOKEN di env (sama dengan Callback Verification Token
 * di dashboard Xendit) agar hanya Xendit yang bisa memanggil.
 * Tahap ini hanya logging; sambungkan ke DB/notifikasi di tahap berikut.
 */
"use strict";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method harus POST." });
    return;
  }
  var expected = process.env.XENDIT_CALLBACK_TOKEN || "";
  var got = req.headers["x-callback-token"] || "";
  if (expected && got !== expected) {
    res.status(401).json({ error: "Token callback tidak valid." });
    return;
  }
  var body = req.body || {};
  console.log(
    "[xendit-webhook]",
    JSON.stringify({
      external_id: body.external_id,
      status: body.status,
      amount: body.amount,
      payment_method: body.payment_method,
      paid_at: body.paid_at,
    })
  );
  res.status(200).json({ ok: true });
};
