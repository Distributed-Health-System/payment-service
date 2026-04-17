# payment-service

Billing source of truth for appointment payments.

## Run

1. Copy `.env.example` to `.env` and fill real values.
2. Install dependencies:

```bash
npm install
```

3. Start service:

```bash
npm run dev
```

## Public API Contract

Base paths:
- `/payments` (gateway-aligned)
- `/api/payments` (legacy compatibility)

Headers:
- User calls via gateway: `x-user-id`, `x-user-role`

### Create Payment Intent

`POST /payments/intent`

Request body:

```json
{
	"appointmentId": "apt_123",
	"currency": "lkr",
	"description": "optional"
}
```

Notes:
- `amount`, `doctorId`, and `patientId` are fetched from appointment-service.
- Duplicate behavior:
	- returns `409` if appointment is already paid
	- reuses pending payment intent if one exists

### Confirm Payment

`POST /payments/confirm`

Backward compatible request body:

```json
{
	"paymentIntentId": "pi_...",
	"appointmentId": "apt_123",
	"paymentMethodId": "pm_card_visa"
}
```

Rules:
- Accepts either `paymentIntentId` or `appointmentId`.
- If both are provided, `paymentIntentId` is used.

### Refund Payment

`POST /payments/:id/refund`

### Queries

- `GET /payments/my`
- `GET /payments/all` (admin)
- `GET /payments/:id`
- `GET /payments/appointment/:appointmentId`

## Validation and Error Shape

Validation failures return:

```json
{
	"success": false,
	"message": "Validation error",
	"errors": ["..."]
}
```

## Status Mapping

Payment service status:
- `pending`
- `succeeded`
- `failed`
- `refunded`

Appointment sync status mapping:
- `pending -> PENDING`
- `succeeded -> CONFIRMED`
- `failed/refunded -> FAILED`

## Lifecycle Sync

Terminal states trigger sync to:
- appointment-service payment status endpoint
- appointment-service confirmed-payment webhook (`/appointments/webhook/payment`)
- notification-service payment status endpoint

Behavior:
- bounded retries + timeout for downstream HTTP
- idempotency key headers for downstream requests
- per-payment sync metadata persisted in Mongo (`sync.appointment`, `sync.appointmentWebhook`, `sync.notification`)

## Stripe Webhooks

Endpoint:
- `POST /payments/webhook`
- `POST /api/payments/webhook`

Supported events:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `charge.refunded`

Webhook events are idempotent via stored processed event IDs.

## Environment Variables

Required:
- `MONGO_URI`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Service integration:
- `APPOINTMENT_SERVICE_URL` (default: `http://localhost:3001`)
- `NOTIFICATION_SERVICE_URL` (default: `http://localhost:3003`)
- `SERVICE_NAME` (default: `payment-service`)

Reliability tuning:
- `DOWNSTREAM_TIMEOUT_MS` (default: `5000`)
- `DOWNSTREAM_MAX_RETRIES` (default: `2`)

