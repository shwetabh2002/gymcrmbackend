# Backend GYM - API Documentation

## Base URL
```
http://localhost:3000
```

## Authentication

All protected endpoints require a JWT access token in the Authorization header:
```
Authorization: Bearer <access_token>
```

---

## Authentication APIs

### 1. Admin Login
Login as an admin user to receive access and refresh tokens.

**Endpoint:** `POST /auth/admin/login`

**Request Body:**
```json
{
  "email": "admin@backendgym.com",
  "password": "Admin@123"
}
```

**Response (200 OK):**
```json
{
  "user": {
    "userId": "69adc83455bd6ea2bcbee3fa",
    "email": "admin@backendgym.com",
    "name": "Admin User",
    "role": "ADMIN"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@backendgym.com", "password": "Admin@123"}'
```

---

### 2. Refresh Token
Get a new access token using a refresh token.

**Endpoint:** `POST /auth/refresh`

**Headers:**
```
Authorization: Bearer <refresh_token>
```

**Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Authorization: Bearer <refresh_token>"
```

---

### 3. Logout
Logout the current user (invalidates refresh token).

**Endpoint:** `POST /auth/logout`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "message": "Logged out successfully"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer <access_token>"
```

---

## Subscription Plans APIs

### 1. Create Subscription Plan
Create a new subscription plan template.

**Endpoint:** `POST /subscription-plans`

**Authentication:** Required (JWT)

**Request Body:**
```json
{
  "name": "Monthly Basic",
  "duration": 1,
  "durationType": "MONTHS",
  "price": 1500,
  "description": "Basic monthly membership"
}
```

**Field Descriptions:**
- `name` (string, required): Name of the subscription plan
- `duration` (number, required): Duration value (must be >= 1)
- `durationType` (enum, required): One of `DAYS`, `MONTHS`, `YEARS`
- `price` (number, required): Price in base currency (must be >= 0)
- `description` (string, optional): Description of the plan

**Response (201 Created):**
```json
{
  "_id": "69adc869d76e8bfe7a7cebaa",
  "name": "Monthly Basic",
  "duration": 1,
  "durationType": "MONTHS",
  "price": 1500,
  "description": "Basic monthly membership",
  "status": "ACTIVE",
  "createdAt": "2026-03-08T19:05:13.716Z",
  "updatedAt": "2026-03-08T19:05:13.716Z",
  "__v": 0
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/subscription-plans \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "name": "Monthly Basic",
    "duration": 1,
    "durationType": "MONTHS",
    "price": 1500,
    "description": "Basic monthly membership"
  }'
```

---

### 2. Get All Subscription Plans
Retrieve all subscription plans.

**Endpoint:** `GET /subscription-plans`

**Authentication:** Required (JWT)

**Response (200 OK):**
```json
[
  {
    "_id": "69adc869d76e8bfe7a7cebaa",
    "name": "Monthly Basic",
    "duration": 1,
    "durationType": "MONTHS",
    "price": 1500,
    "description": "Basic monthly membership",
    "status": "ACTIVE",
    "createdAt": "2026-03-08T19:05:13.716Z",
    "updatedAt": "2026-03-08T19:05:13.716Z",
    "__v": 0
  },
  {
    "_id": "69adc869d76e8bfe7a7cebab",
    "name": "Quarterly Premium",
    "duration": 3,
    "durationType": "MONTHS",
    "price": 4000,
    "description": "Premium quarterly membership with benefits",
    "status": "ACTIVE",
    "createdAt": "2026-03-08T19:10:00.000Z",
    "updatedAt": "2026-03-08T19:10:00.000Z",
    "__v": 0
  }
]
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/subscription-plans \
  -H "Authorization: Bearer <access_token>"
```

---

### 3. Get Subscription Plan by ID
Retrieve a specific subscription plan by its ID.

**Endpoint:** `GET /subscription-plans/:id`

**Authentication:** Required (JWT)

**URL Parameters:**
- `id` (string, required): MongoDB ObjectId of the subscription plan

**Response (200 OK):**
```json
{
  "_id": "69adc869d76e8bfe7a7cebaa",
  "name": "Monthly Basic",
  "duration": 1,
  "durationType": "MONTHS",
  "price": 1500,
  "description": "Basic monthly membership",
  "status": "ACTIVE",
  "createdAt": "2026-03-08T19:05:13.716Z",
  "updatedAt": "2026-03-08T19:05:13.716Z",
  "__v": 0
}
```

**Error Response (404 Not Found):**
```json
{
  "message": "Subscription plan with ID 69adc869d76e8bfe7a7cebaa not found",
  "error": "Not Found",
  "statusCode": 404
}
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/subscription-plans/69adc869d76e8bfe7a7cebaa \
  -H "Authorization: Bearer <access_token>"
```

---

### 4. Update Subscription Plan
Update an existing subscription plan. All fields are optional.

**Endpoint:** `PUT /subscription-plans/:id`

**Authentication:** Required (JWT)

**URL Parameters:**
- `id` (string, required): MongoDB ObjectId of the subscription plan

**Request Body:**
```json
{
  "price": 1800,
  "description": "Basic monthly membership - Updated price",
  "status": "INACTIVE"
}
```

**Updatable Fields:**
- `name` (string, optional): Plan name
- `duration` (number, optional): Duration value (must be >= 1)
- `durationType` (enum, optional): One of `DAYS`, `MONTHS`, `YEARS`
- `price` (number, optional): Price (must be >= 0)
- `description` (string, optional): Description
- `status` (enum, optional): One of `ACTIVE`, `INACTIVE`, `ARCHIVED`

**Response (200 OK):**
```json
{
  "_id": "69adc869d76e8bfe7a7cebaa",
  "name": "Monthly Basic",
  "duration": 1,
  "durationType": "MONTHS",
  "price": 1800,
  "description": "Basic monthly membership - Updated price",
  "status": "INACTIVE",
  "createdAt": "2026-03-08T19:05:13.716Z",
  "updatedAt": "2026-03-08T19:08:08.455Z",
  "__v": 0
}
```

**Error Response (404 Not Found):**
```json
{
  "message": "Subscription plan with ID 69adc869d76e8bfe7a7cebaa not found",
  "error": "Not Found",
  "statusCode": 404
}
```

**cURL Example:**
```bash
curl -X PUT http://localhost:3000/subscription-plans/69adc869d76e8bfe7a7cebaa \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "price": 1800,
    "description": "Basic monthly membership - Updated price"
  }'
```

---

### 5. Delete Subscription Plan
Delete a subscription plan by its ID.

**Endpoint:** `DELETE /subscription-plans/:id`

**Authentication:** Required (JWT)

**URL Parameters:**
- `id` (string, required): MongoDB ObjectId of the subscription plan

**Response (200 OK):**
```json
{
  "message": "Subscription plan deleted successfully"
}
```

**Error Response (404 Not Found):**
```json
{
  "message": "Subscription plan with ID 69adc869d76e8bfe7a7cebaa not found",
  "error": "Not Found",
  "statusCode": 404
}
```

**cURL Example:**
```bash
curl -X DELETE http://localhost:3000/subscription-plans/69adc869d76e8bfe7a7cebaa \
  -H "Authorization: Bearer <access_token>"
```

---

## Member Management APIs

### 1. Create Member
Create a new gym member.

**Endpoint:** `POST /members`

**Authentication:** Required (JWT)

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john.doe@example.com",
  "phone": "+1234567890",
  "address": "123 Main St, New York, NY 10001",
  "emergencyContact": "+1987654321",
  "memberStatus": "ACTIVE"
}
```

**Field Descriptions:**
- `name` (string, required): Full name of the member
- `email` (string, required): Email address (must be unique)
- `phone` (string, required): Phone number
- `address` (string, optional): Physical address
- `emergencyContact` (string, optional): Emergency contact number
- `memberStatus` (enum, optional): One of `ACTIVE`, `INACTIVE`, `SUSPENDED`. Defaults to `ACTIVE`

**Response (201 Created):**
```json
{
  "_id": "69adcc16c8030c338569d895",
  "email": "john.doe@example.com",
  "name": "John Doe",
  "role": "USER",
  "userType": "MEMBER",
  "phone": "+1234567890",
  "address": "123 Main St, New York, NY 10001",
  "emergencyContact": "+1987654321",
  "memberStatus": "ACTIVE",
  "currentSubscriptionId": null,
  "createdAt": "2026-03-08T19:20:54.395Z",
  "updatedAt": "2026-03-08T19:20:54.395Z",
  "__v": 0
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/members \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "name": "John Doe",
    "email": "john.doe@example.com",
    "phone": "+1234567890",
    "address": "123 Main St, New York, NY 10001",
    "emergencyContact": "+1987654321",
    "memberStatus": "ACTIVE"
  }'
```

---

### 2. Get All Members
Retrieve all gym members.

**Endpoint:** `GET /members`

**Authentication:** Required (JWT)

**Response (200 OK):**
```json
[
  {
    "_id": "69adcc16c8030c338569d895",
    "email": "john.doe@example.com",
    "name": "John Doe",
    "role": "USER",
    "userType": "MEMBER",
    "phone": "+1234567890",
    "address": "123 Main St, New York, NY 10001",
    "emergencyContact": "+1987654321",
    "memberStatus": "ACTIVE",
    "currentSubscriptionId": null,
    "createdAt": "2026-03-08T19:20:54.395Z",
    "updatedAt": "2026-03-08T19:20:54.395Z",
    "__v": 0
  }
]
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/members \
  -H "Authorization: Bearer <access_token>"
```

---

### 3. Get Member By ID
Retrieve a specific member by their ID.

**Endpoint:** `GET /members/:id`

**Authentication:** Required (JWT)

**Path Parameters:**
- `id` (string, required): MongoDB ObjectId of the member

**Response (200 OK):**
```json
{
  "_id": "69adcc16c8030c338569d895",
  "email": "john.doe@example.com",
  "name": "John Doe",
  "role": "USER",
  "userType": "MEMBER",
  "phone": "+1234567890",
  "address": "123 Main St, New York, NY 10001",
  "emergencyContact": "+1987654321",
  "memberStatus": "ACTIVE",
  "currentSubscriptionId": null,
  "createdAt": "2026-03-08T19:20:54.395Z",
  "updatedAt": "2026-03-08T19:20:54.395Z",
  "__v": 0
}
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/members/69adcc16c8030c338569d895 \
  -H "Authorization: Bearer <access_token>"
```

**Error Response (404 Not Found):**
```json
{
  "message": "Member with ID 69adcc16c8030c338569d895 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

### 4. Update Member
Update an existing member's information.

**Endpoint:** `PUT /members/:id`

**Authentication:** Required (JWT)

**Path Parameters:**
- `id` (string, required): MongoDB ObjectId of the member

**Request Body:**
All fields are optional. Only provided fields will be updated.
```json
{
  "phone": "+1999888777",
  "address": "456 Updated Ave, Los Angeles, CA 90001",
  "memberStatus": "INACTIVE"
}
```

**Response (200 OK):**
```json
{
  "_id": "69adcc16c8030c338569d895",
  "email": "john.doe@example.com",
  "name": "John Doe",
  "role": "USER",
  "userType": "MEMBER",
  "phone": "+1999888777",
  "address": "456 Updated Ave, Los Angeles, CA 90001",
  "emergencyContact": "+1987654321",
  "memberStatus": "INACTIVE",
  "currentSubscriptionId": null,
  "createdAt": "2026-03-08T19:20:54.395Z",
  "updatedAt": "2026-03-08T19:22:35.680Z",
  "__v": 0
}
```

**cURL Example:**
```bash
curl -X PUT http://localhost:3000/members/69adcc16c8030c338569d895 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "phone": "+1999888777",
    "address": "456 Updated Ave, Los Angeles, CA 90001"
  }'
```

**Error Response (409 Conflict) - Duplicate Email:**
```json
{
  "message": "Email john.doe@example.com is already in use",
  "error": "Conflict",
  "statusCode": 409
}
```

---

### 5. Delete Member
Delete a member from the system.

**Endpoint:** `DELETE /members/:id`

**Authentication:** Required (JWT)

**Path Parameters:**
- `id` (string, required): MongoDB ObjectId of the member

**Response (200 OK):**
```json
{
  "message": "Member deleted successfully"
}
```

**cURL Example:**
```bash
curl -X DELETE http://localhost:3000/members/69adcc16c8030c338569d895 \
  -H "Authorization: Bearer <access_token>"
```

**Error Response (404 Not Found):**
```json
{
  "message": "Member with ID 69adcc16c8030c338569d895 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

## Member Subscriptions APIs

### 1. Create Member Subscription
Assign a subscription plan to a member. The system automatically calculates the expiry date based on the plan's duration and handles payment tracking.

**Endpoint:** `POST /member-subscriptions`

**Authentication:** Required (JWT)

**Request Body:**
```json
{
  "memberId": "69af0b7abae02de0e9664dbd",
  "planId": "69af0b9abae02de0e9664dc3",
  "startDate": "2026-03-09",
  "initialPayment": 500
}
```

**Field Descriptions:**
- `memberId` (string, required): MongoDB ObjectId of the member (must be a MEMBER userType)
- `planId` (string, required): MongoDB ObjectId of the subscription plan
- `startDate` (string, required): Start date in ISO format (YYYY-MM-DD)
- `initialPayment` (number, optional): Initial payment amount. Defaults to 0

**Business Logic:**
- Validates that the member and plan exist
- Prevents creating a subscription if the member already has an ACTIVE subscription
- Automatically calculates expiry date based on plan duration (DAYS/MONTHS/YEARS)
- Calculates pending amount (planPrice - initialPayment)
- Sets payment status: UNPAID, PARTIALLY_PAID, or FULLY_PAID
- Updates member's `currentSubscriptionId` field

**Response (201 Created):**
```json
{
  "_id": "69af0ba6bae02de0e9664dc9",
  "memberId": "69af0b7abae02de0e9664dbd",
  "planId": "69af0b9abae02de0e9664dc3",
  "startDate": "2026-03-09T00:00:00.000Z",
  "expiryDate": "2026-04-09T00:00:00.000Z",
  "subscriptionStatus": "ACTIVE",
  "planPrice": 1000,
  "totalPaid": 500,
  "pendingAmount": 500,
  "paymentStatus": "PARTIALLY_PAID",
  "createdAt": "2026-03-09T18:04:22.987Z",
  "updatedAt": "2026-03-09T18:04:22.987Z",
  "__v": 0
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/member-subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "memberId": "69af0b7abae02de0e9664dbd",
    "planId": "69af0b9abae02de0e9664dc3",
    "startDate": "2026-03-09",
    "initialPayment": 500
  }'
```

**Error Response (404 Not Found) - Invalid Member:**
```json
{
  "message": "Member with ID 69adcc16c8030c338569d895 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

**Error Response (409 Conflict) - Active Subscription Exists:**
```json
{
  "message": "Member already has an active subscription. Please expire or cancel the existing subscription first.",
  "error": "Conflict",
  "statusCode": 409
}
```

---

### 2. Get All Member Subscriptions
Retrieve all member subscriptions with populated member and plan details.

**Endpoint:** `GET /member-subscriptions`

**Authentication:** Required (JWT)

**Response (200 OK):**
```json
[
  {
    "_id": "69af0ba6bae02de0e9664dc9",
    "memberId": {
      "_id": "69af0b7abae02de0e9664dbd",
      "email": "member1@gym.com",
      "name": "Test Member",
      "role": "USER",
      "userType": "MEMBER",
      "phone": "1234567890",
      "address": "123 Main St",
      "emergencyContact": null,
      "memberStatus": "ACTIVE",
      "currentSubscriptionId": "69af0ba6bae02de0e9664dc9",
      "createdAt": "2026-03-09T18:03:38.786Z",
      "updatedAt": "2026-03-09T18:04:23.137Z",
      "__v": 0
    },
    "planId": {
      "_id": "69af0b9abae02de0e9664dc3",
      "name": "Monthly Membership",
      "duration": 1,
      "durationType": "MONTHS",
      "price": 1000,
      "description": "Standard monthly gym membership",
      "status": "ACTIVE",
      "createdAt": "2026-03-09T18:04:10.865Z",
      "updatedAt": "2026-03-09T18:04:10.865Z",
      "__v": 0
    },
    "startDate": "2026-03-09T00:00:00.000Z",
    "expiryDate": "2026-04-09T00:00:00.000Z",
    "subscriptionStatus": "ACTIVE",
    "planPrice": 1000,
    "totalPaid": 500,
    "pendingAmount": 500,
    "paymentStatus": "PARTIALLY_PAID",
    "createdAt": "2026-03-09T18:04:22.987Z",
    "updatedAt": "2026-03-09T18:04:22.987Z",
    "__v": 0
  }
]
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/member-subscriptions \
  -H "Authorization: Bearer <access_token>"
```

---

### 3. Get Member Subscription by ID
Retrieve a specific subscription by its ID with populated member and plan details.

**Endpoint:** `GET /member-subscriptions/:id`

**Authentication:** Required (JWT)

**Path Parameters:**
- `id` (string, required): MongoDB ObjectId of the subscription

**Response (200 OK):**
```json
{
  "_id": "69af0ba6bae02de0e9664dc9",
  "memberId": {
    "_id": "69af0b7abae02de0e9664dbd",
    "email": "member1@gym.com",
    "name": "Test Member",
    "role": "USER",
    "userType": "MEMBER",
    "phone": "1234567890",
    "address": "123 Main St",
    "emergencyContact": null,
    "memberStatus": "ACTIVE",
    "currentSubscriptionId": "69af0ba6bae02de0e9664dc9",
    "createdAt": "2026-03-09T18:03:38.786Z",
    "updatedAt": "2026-03-09T18:04:23.137Z",
    "__v": 0
  },
  "planId": {
    "_id": "69af0b9abae02de0e9664dc3",
    "name": "Monthly Membership",
    "duration": 1,
    "durationType": "MONTHS",
    "price": 1000,
    "description": "Standard monthly gym membership",
    "status": "ACTIVE",
    "createdAt": "2026-03-09T18:04:10.865Z",
    "updatedAt": "2026-03-09T18:04:10.865Z",
    "__v": 0
  },
  "startDate": "2026-03-09T00:00:00.000Z",
  "expiryDate": "2026-04-09T00:00:00.000Z",
  "subscriptionStatus": "ACTIVE",
  "planPrice": 1000,
  "totalPaid": 500,
  "pendingAmount": 500,
  "paymentStatus": "PARTIALLY_PAID",
  "createdAt": "2026-03-09T18:04:22.987Z",
  "updatedAt": "2026-03-09T18:04:22.987Z",
  "__v": 0
}
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/member-subscriptions/69af0ba6bae02de0e9664dc9 \
  -H "Authorization: Bearer <access_token>"
```

**Error Response (404 Not Found):**
```json
{
  "message": "Member subscription with ID 69af0ba6bae02de0e9664dc9 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

### 4. Get Subscriptions by Member ID
Retrieve all subscriptions for a specific member, sorted by creation date (newest first).

**Endpoint:** `GET /member-subscriptions/member/:memberId`

**Authentication:** Required (JWT)

**Path Parameters:**
- `memberId` (string, required): MongoDB ObjectId of the member

**Response (200 OK):**
```json
[
  {
    "_id": "69af0ba6bae02de0e9664dc9",
    "memberId": "69af0b7abae02de0e9664dbd",
    "planId": {
      "_id": "69af0b9abae02de0e9664dc3",
      "name": "Monthly Membership",
      "duration": 1,
      "durationType": "MONTHS",
      "price": 1000,
      "description": "Standard monthly gym membership",
      "status": "ACTIVE",
      "createdAt": "2026-03-09T18:04:10.865Z",
      "updatedAt": "2026-03-09T18:04:10.865Z",
      "__v": 0
    },
    "startDate": "2026-03-09T00:00:00.000Z",
    "expiryDate": "2026-04-09T00:00:00.000Z",
    "subscriptionStatus": "ACTIVE",
    "planPrice": 1000,
    "totalPaid": 1000,
    "pendingAmount": 0,
    "paymentStatus": "FULLY_PAID",
    "createdAt": "2026-03-09T18:04:22.987Z",
    "updatedAt": "2026-03-09T18:04:44.057Z",
    "__v": 0
  }
]
```

**cURL Example:**
```bash
curl -X GET http://localhost:3000/member-subscriptions/member/69af0b7abae02de0e9664dbd \
  -H "Authorization: Bearer <access_token>"
```

**Error Response (404 Not Found) - Invalid Member:**
```json
{
  "message": "Member with ID 69af0b7abae02de0e9664dbd not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

### 5. Update Member Subscription
Update subscription details such as dates or status. When changing status to EXPIRED or CANCELLED, the subscription is automatically removed from the member's current subscription.

**Endpoint:** `PUT /member-subscriptions/:id`

**Authentication:** Required (JWT)

**Path Parameters:**
- `id` (string, required): MongoDB ObjectId of the subscription

**Request Body:**
All fields are optional. Only provided fields will be updated.
```json
{
  "subscriptionStatus": "CANCELLED",
  "expiryDate": "2026-04-15"
}
```

**Updatable Fields:**
- `startDate` (string, optional): Start date in ISO format
- `expiryDate` (string, optional): Expiry date in ISO format
- `subscriptionStatus` (enum, optional): One of `ACTIVE`, `EXPIRED`, `CANCELLED`
- `planPrice` (number, optional): Price snapshot (not recommended to change)
- `totalPaid` (number, optional): Total amount paid (use payment endpoint instead)
- `pendingAmount` (number, optional): Pending amount (use payment endpoint instead)
- `paymentStatus` (enum, optional): One of `UNPAID`, `PARTIALLY_PAID`, `FULLY_PAID` (use payment endpoint instead)

**Response (200 OK):**
```json
{
  "_id": "69af0ba6bae02de0e9664dc9",
  "memberId": {
    "_id": "69af0b7abae02de0e9664dbd",
    "email": "member1@gym.com",
    "name": "Test Member",
    "role": "USER",
    "userType": "MEMBER",
    "phone": "1234567890",
    "address": "123 Main St",
    "emergencyContact": null,
    "memberStatus": "ACTIVE",
    "currentSubscriptionId": null,
    "createdAt": "2026-03-09T18:03:38.786Z",
    "updatedAt": "2026-03-09T18:05:23.137Z",
    "__v": 0
  },
  "planId": {
    "_id": "69af0b9abae02de0e9664dc3",
    "name": "Monthly Membership",
    "duration": 1,
    "durationType": "MONTHS",
    "price": 1000,
    "description": "Standard monthly gym membership",
    "status": "ACTIVE",
    "createdAt": "2026-03-09T18:04:10.865Z",
    "updatedAt": "2026-03-09T18:04:10.865Z",
    "__v": 0
  },
  "startDate": "2026-03-09T00:00:00.000Z",
  "expiryDate": "2026-04-15T00:00:00.000Z",
  "subscriptionStatus": "CANCELLED",
  "planPrice": 1000,
  "totalPaid": 1000,
  "pendingAmount": 0,
  "paymentStatus": "FULLY_PAID",
  "createdAt": "2026-03-09T18:04:22.987Z",
  "updatedAt": "2026-03-09T18:05:23.100Z",
  "__v": 0
}
```

**cURL Example:**
```bash
curl -X PUT http://localhost:3000/member-subscriptions/69af0ba6bae02de0e9664dc9 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "subscriptionStatus": "CANCELLED"
  }'
```

**Error Response (404 Not Found):**
```json
{
  "message": "Member subscription with ID 69af0ba6bae02de0e9664dc9 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

### 6. Delete Member Subscription
Delete a member subscription. If the subscription is the member's current active subscription, it will be removed from the member's record.

**Endpoint:** `DELETE /member-subscriptions/:id`

**Authentication:** Required (JWT)

**Path Parameters:**
- `id` (string, required): MongoDB ObjectId of the subscription

**Response (200 OK):**
```json
{
  "message": "Member subscription deleted successfully"
}
```

**cURL Example:**
```bash
curl -X DELETE http://localhost:3000/member-subscriptions/69af0ba6bae02de0e9664dc9 \
  -H "Authorization: Bearer <access_token>"
```

**Error Response (404 Not Found):**
```json
{
  "message": "Member subscription with ID 69af0ba6bae02de0e9664dc9 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

### 7. Add Payment to Subscription
Record a payment for a subscription. This endpoint automatically updates the total paid, pending amount, and payment status.

**Endpoint:** `POST /member-subscriptions/:id/payment`

**Authentication:** Required (JWT)

**Path Parameters:**
- `id` (string, required): MongoDB ObjectId of the subscription

**Request Body:**
```json
{
  "amount": 500
}
```

**Field Descriptions:**
- `amount` (number, required): Payment amount (must be greater than 0)

**Business Logic:**
- Adds the payment amount to `totalPaid`
- Recalculates `pendingAmount` (planPrice - totalPaid)
- Automatically updates `paymentStatus`:
  - `FULLY_PAID` if pendingAmount <= 0
  - `PARTIALLY_PAID` if totalPaid > 0 and pendingAmount > 0
  - `UNPAID` if totalPaid = 0

**Response (200 OK):**
```json
{
  "_id": "69af0ba6bae02de0e9664dc9",
  "memberId": {
    "_id": "69af0b7abae02de0e9664dbd",
    "email": "member1@gym.com",
    "name": "Test Member",
    "role": "USER",
    "userType": "MEMBER",
    "phone": "1234567890",
    "address": "123 Main St",
    "emergencyContact": null,
    "memberStatus": "ACTIVE",
    "currentSubscriptionId": "69af0ba6bae02de0e9664dc9",
    "createdAt": "2026-03-09T18:03:38.786Z",
    "updatedAt": "2026-03-09T18:04:23.137Z",
    "__v": 0
  },
  "planId": {
    "_id": "69af0b9abae02de0e9664dc3",
    "name": "Monthly Membership",
    "duration": 1,
    "durationType": "MONTHS",
    "price": 1000,
    "description": "Standard monthly gym membership",
    "status": "ACTIVE",
    "createdAt": "2026-03-09T18:04:10.865Z",
    "updatedAt": "2026-03-09T18:04:10.865Z",
    "__v": 0
  },
  "startDate": "2026-03-09T00:00:00.000Z",
  "expiryDate": "2026-04-09T00:00:00.000Z",
  "subscriptionStatus": "ACTIVE",
  "planPrice": 1000,
  "totalPaid": 1000,
  "pendingAmount": 0,
  "paymentStatus": "FULLY_PAID",
  "createdAt": "2026-03-09T18:04:22.987Z",
  "updatedAt": "2026-03-09T18:04:44.057Z",
  "__v": 0
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/member-subscriptions/69af0ba6bae02de0e9664dc9/payment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access_token>" \
  -d '{
    "amount": 500
  }'
```

**Error Response (400 Bad Request) - Invalid Amount:**
```json
{
  "message": "Payment amount must be greater than 0",
  "error": "Bad Request",
  "statusCode": 400
}
```

**Error Response (404 Not Found):**
```json
{
  "message": "Member subscription with ID 69af0ba6bae02de0e9664dc9 not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

## Common Error Responses

### 401 Unauthorized
```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

### 400 Bad Request (Validation Error)
```json
{
  "message": [
    "duration must not be less than 1",
    "price must not be less than 0"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### 500 Internal Server Error
```json
{
  "message": "Internal server error",
  "statusCode": 500
}
```

---

## Enums Reference

### DurationType
- `DAYS` - Duration in days
- `MONTHS` - Duration in months
- `YEARS` - Duration in years

### PlanStatus
- `ACTIVE` - Plan is active and can be assigned to members
- `INACTIVE` - Plan is inactive but not deleted
- `ARCHIVED` - Plan is archived (historical data)

### Role (for authentication)
- `SUPER_ADMIN` - Super administrator with full access
- `ADMIN` - Administrator with management access
- `MANAGER` - Manager with limited access
- `USER` - Regular user (not used for login currently)

### MemberStatus
- `ACTIVE` - Member is active and can use gym facilities
- `INACTIVE` - Member is inactive (not using the gym)
- `SUSPENDED` - Member is temporarily suspended

### SubscriptionStatus
- `ACTIVE` - Subscription is currently active
- `EXPIRED` - Subscription has expired
- `CANCELLED` - Subscription was cancelled before expiry

### PaymentStatus
- `UNPAID` - No payment has been made
- `PARTIALLY_PAID` - Partial payment received, balance pending
- `FULLY_PAID` - Full payment completed

---

## Notes

1. **Authentication**: All API endpoints require a valid JWT access token obtained from the login endpoint.

2. **Token Expiry**:
   - Access tokens expire after 7 days
   - Refresh tokens expire after 365 days

3. **Validation**: All request bodies are validated. Missing required fields or invalid data types will return a 400 Bad Request error.

4. **MongoDB ObjectId**: All IDs in the system are MongoDB ObjectIds (24-character hexadecimal strings).

5. **Timestamps**: All entities include `createdAt` and `updatedAt` timestamps in ISO 8601 format.

6. **Member Subscriptions**:
   - Members can only have ONE active subscription at a time
   - Expiry dates are automatically calculated based on plan duration
   - Payment tracking is automatic - use the payment endpoint to record payments
   - Changing subscription status to EXPIRED or CANCELLED automatically updates the member's current subscription reference
