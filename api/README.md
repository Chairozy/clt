# Backend Xendit `clt` (serverless, tanpa dependency)

Folder ini di-deploy **terpisah** dari GitHub Pages (yang hanya bisa statis).
Rekomendasi: Vercel — import repo, set Root Directory ke folder ini
atau deploy sebagai bagian monorepo; endpoint tersedia di
`https://<project>.vercel.app/api/...`.

## Env vars (Vercel → Settings → Environment Variables)

| Key | Wajib | Contoh |
|---|---|---|
| `XENDIT_SECRET_KEY` | Ya | `xnd_development_...` (test dulu) |
| `SUCCESS_URL` | Tidak | `https://cahlanangtransport.com/sukses.html` |
| `FAILURE_URL` | Tidak | `https://cahlanangtransport.com/gagal.html` |
| `XENDIT_CALLBACK_TOKEN` | Produksi | Token dari dashboard Xendit → Settings → Callbacks |

## Sambungkan frontend

Di `index.html` dalam `<script>` cart, isi:

```js
var API_BASE_URL = "https://<project>.vercel.app";
```

## Tes lokal

```bash
curl -X POST http://localhost:3000/api/create-invoice \
  -H "Content-Type: application/json" \
  -d '{"customer":{"name":"Tes","phone":"08123456789"},"items":[{"type":"taxi","id":"taxi-pontianak-bandara","name":"Taksi Pontianak → Bandara","date":"2026-12-01","qty":2,"unitPrice":100000}]}'
```

## Webhook Xendit

Dashboard Xendit → Settings → Callbacks → Invoice callback URL:

```
https://<project>.vercel.app/api/xendit-webhook
```

Header `x-callback-token` diverifikasi terhadap `XENDIT_CALLBACK_TOKEN`.
