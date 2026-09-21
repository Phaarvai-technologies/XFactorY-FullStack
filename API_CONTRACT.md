# MVP API Contract

Base URL: `/api/v1`. All protected calls use
`Authorization: Bearer <Clerk session JWT>`.

| Method | Endpoint | Purpose | Success |
|---|---|---|---|
| GET | `/health/live` | Process health | 200 |
| GET | `/api/v1/identity/me` | User and roles | 200 |
| PUT | `/api/v1/identity/me/roles` | Replace selected roles | 200 |
| GET | `/api/v1/manufacturer/account` | Check/load active organization's account | 200 |
| POST | `/api/v1/manufacturer/account` | Create/update initial account | 201 |
| POST | `/api/v1/webhooks/clerk` | Clerk synchronization | 200 |

## Save roles

```json
{"roles":["manufacturer","vendor"]}
```

Allowed values are `manufacturer`, `visionary`, `vendor`,
`logistics_provider`, `labour_supplier`, `legal_writer`, `investor`, and
`market_lead`. Marketplace roles do not grant security permissions.

## Create Manufacturer account

The frontend must create and activate a Clerk organization and request a fresh
JWT before calling this operation.

```json
{
  "first_name": "Jordan",
  "last_name": "Ellis",
  "contact": "jordan@company.com",
  "date_of_birth": "1992-06-20",
  "company_name": "Ellis Manufacturing",
  "company_category": "Automotive & Machinery",
  "country": "India",
  "phone": "+91 98765 43210",
  "production_capacity": "10000 units/month"
}
```

Success:

```json
{
  "organization_id": "internal-uuid",
  "status": "in_progress",
  "completion_percentage": 35
}
```

Errors use FastAPI's `{ "detail": ... }` envelope. Important status codes are
401 invalid/missing token, 409 no active Clerk organization, 422 validation,
and 503 missing server configuration.

