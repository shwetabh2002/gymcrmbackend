# New Simplified Flow - cURL Guide

Complete guide with cURL commands for the new member registration flow.

---

## Prerequisites

**Base URL:** `http://localhost:3000` (or your deployed URL)

---

## STEP 1: Authentication

Get your JWT token first (required for all endpoints).

```bash
# Login as admin
curl -X POST http://localhost:3000/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@backendgym.com",
    "password": "Admin@123"
  }'
```

**Response:**
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

**Copy the `accessToken` and use it in all subsequent requests.**

---

## STEP 2: Register a New Member

### Scenario A: Full Payment (No Pending)

```bash
curl -X POST http://localhost:3000/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "idNo": "GYM-001",
    "date": "2026-03-21",
    "name": "John Smith",
    "contactNumber": "9876543210",
    "dob": "1995-05-15",
    "instagramHandle": "@johnsmith",
    "membershipMonths": 6,
    "amount": 6000,
    "received": 6000,
    "pending": 0,
    "mop": "cash",
    "transactionId": "CASH-001",
    "salesPerson": "Sarah Johnson",
    "trainingType": "PT",
    "trainer": "Mike Davis",
    "memberType": "New",
    "startingDate": "2026-03-21",
    "expiryDate": "2026-09-21",
    "memberStatus": "ACTIVE",
    "address": "123 Fitness Street",
    "emergencyContact": "9876543211"
  }'
```

**Response:**
```json
{
  "member": {
    "_id": "69be51a3337375e4f02b91fe",
    "email": "member9876543210@gym.com",
    "name": "John Smith",
    "phone": "9876543210",
    "idNo": "GYM-001",
    "dob": "1995-05-15T00:00:00.000Z",
    "instagramHandle": "@johnsmith",
    "salesPerson": "Sarah Johnson",
    "trainer": "Mike Davis",
    "trainingType": "PT",
    "memberType": "New",
    "membershipMonths": 6,
    "startingDate": "2026-03-21T00:00:00.000Z",
    "expiryDate": "2026-09-21T00:00:00.000Z",
    "membershipAmount": 6000,
    "memberStatus": "ACTIVE",
    "address": "123 Fitness Street",
    "emergencyContact": "9876543211"
  },
  "payment": {
    "_id": "69be51a3337375e4f02b9200",
    "memberId": "69be51a3337375e4f02b91fe",
    "amount": 6000,
    "received": 6000,
    "pending": 0,
    "mop": "cash",
    "paymentDate": "2026-03-21T00:00:00.000Z",
    "transactionId": "CASH-001",
    "notes": "Initial payment for 6 months membership"
  }
}
```

---

### Scenario B: Partial Payment (Auto-calculate Pending)

```bash
curl -X POST http://localhost:3000/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "idNo": "GYM-002",
    "date": "2026-03-21",
    "name": "Jane Doe",
    "contactNumber": "8765432109",
    "dob": "1998-08-20",
    "instagramHandle": "@janedoe_fit",
    "membershipMonths": 12,
    "amount": 12000,
    "received": 8000,
    "mop": "upi",
    "transactionId": "UPI-2026-001",
    "salesPerson": "Tom Wilson",
    "trainingType": "GT",
    "trainer": "Lisa Anderson",
    "memberType": "New",
    "startingDate": "2026-03-21",
    "expiryDate": "2027-03-21",
    "memberStatus": "ACTIVE"
  }'
```

**Response:**
```json
{
  "member": {
    "_id": "69be51a3337375e4f02b9205",
    "email": "member8765432109@gym.com",
    "name": "Jane Doe",
    "phone": "8765432109",
    "membershipMonths": 12,
    "membershipAmount": 12000,
    ...
  },
  "payment": {
    "_id": "69be51a3337375e4f02b9207",
    "memberId": "69be51a3337375e4f02b9205",
    "amount": 12000,
    "received": 8000,
    "pending": 4000,  // Auto-calculated: 12000 - 8000
    "mop": "upi",
    ...
  }
}
```

---

### Scenario C: Card Payment with Transaction ID

```bash
curl -X POST http://localhost:3000/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "idNo": "GYM-003",
    "date": "2026-03-21",
    "name": "Robert Brown",
    "contactNumber": "7654321098",
    "membershipMonths": 3,
    "amount": 3000,
    "received": 3000,
    "mop": "card",
    "transactionId": "CARD-TXN-123456",
    "salesPerson": "Emily Davis",
    "trainingType": "GT",
    "trainer": "Chris Martin",
    "memberType": "Renewal",
    "startingDate": "2026-03-21",
    "expiryDate": "2026-06-21"
  }'
```

---

### Scenario D: Bank Transfer

```bash
curl -X POST http://localhost:3000/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "idNo": "GYM-004",
    "date": "2026-03-21",
    "name": "Maria Garcia",
    "contactNumber": "6543210987",
    "membershipMonths": 6,
    "amount": 6000,
    "received": 6000,
    "mop": "bank_transfer",
    "transactionId": "NEFT-987654321",
    "salesPerson": "David Lee",
    "trainingType": "PT",
    "trainer": "Anna White",
    "memberType": "New",
    "startingDate": "2026-03-21",
    "expiryDate": "2026-09-21"
  }'
```

---

## STEP 3: Get All Registered Members

```bash
curl -X GET http://localhost:3000/members/register \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Response:**
```json
[
  {
    "_id": "69be51a3337375e4f02b91fe",
    "email": "member9876543210@gym.com",
    "name": "John Smith",
    "phone": "9876543210",
    "membershipMonths": 6,
    "startingDate": "2026-03-21T00:00:00.000Z",
    "expiryDate": "2026-09-21T00:00:00.000Z",
    "membershipAmount": 6000,
    "trainer": "Mike Davis",
    "memberStatus": "ACTIVE"
  },
  {
    "_id": "69be51a3337375e4f02b9205",
    "email": "member8765432109@gym.com",
    "name": "Jane Doe",
    "phone": "8765432109",
    "membershipMonths": 12,
    "membershipAmount": 12000,
    ...
  }
]
```

---

## STEP 4: Get All Payments (All Members)

```bash
curl -X GET http://localhost:3000/members/payments \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Response:**
```json
[
  {
    "_id": "69be51a3337375e4f02b9200",
    "memberId": {
      "_id": "69be51a3337375e4f02b91fe",
      "name": "John Smith",
      "email": "member9876543210@gym.com",
      "phone": "9876543210"
    },
    "amount": 6000,
    "received": 6000,
    "pending": 0,
    "mop": "cash",
    "paymentDate": "2026-03-21T00:00:00.000Z",
    "transactionId": "CASH-001",
    "notes": "Initial payment for 6 months membership",
    "createdAt": "2026-03-21T08:06:11.333Z"
  },
  {
    "_id": "69be51a3337375e4f02b9207",
    "memberId": {
      "_id": "69be51a3337375e4f02b9205",
      "name": "Jane Doe",
      "email": "member8765432109@gym.com",
      "phone": "8765432109"
    },
    "amount": 12000,
    "received": 8000,
    "pending": 4000,
    "mop": "upi",
    "paymentDate": "2026-03-21T00:00:00.000Z",
    "transactionId": "UPI-2026-001",
    "notes": "Initial payment for 12 months membership",
    "createdAt": "2026-03-21T08:07:25.186Z"
  }
]
```

---

## STEP 5: Get Member's Payment History

```bash
# Replace MEMBER_ID with actual member ID from Step 2
curl -X GET http://localhost:3000/members/MEMBER_ID/payments \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Example:
curl -X GET http://localhost:3000/members/69be51a3337375e4f02b91fe/payments \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Response:**
```json
[
  {
    "_id": "69be51a3337375e4f02b9200",
    "memberId": "69be51a3337375e4f02b91fe",
    "amount": 6000,
    "received": 6000,
    "pending": 0,
    "mop": "cash",
    "paymentDate": "2026-03-21T00:00:00.000Z",
    "transactionId": "CASH-001",
    "notes": "Initial payment for 6 months membership",
    "createdAt": "2026-03-21T08:06:11.333Z"
  }
]
```

---

## STEP 6: Get All Members (Old + New Flow)

This shows ALL members (both old detailed flow and new simplified flow):

```bash
curl -X GET http://localhost:3000/members \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Response includes both:**
- Members created via old flow (with `currentSubscriptionId`)
- Members created via new flow (with `membershipMonths`)

---

## Complete Flow Example

Here's a complete end-to-end example:

```bash
#!/bin/bash

# Step 1: Login
echo "Step 1: Logging in..."
TOKEN=$(curl -s -X POST http://localhost:3000/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@backendgym.com","password":"Admin@123"}' | \
  jq -r '.tokens.accessToken')

echo "Token: $TOKEN"
echo ""

# Step 2: Register a member
echo "Step 2: Registering new member..."
RESPONSE=$(curl -s -X POST http://localhost:3000/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "idNo": "GYM-005",
    "date": "2026-03-21",
    "name": "Alex Johnson",
    "contactNumber": "5432109876",
    "membershipMonths": 6,
    "amount": 6000,
    "received": 4000,
    "mop": "upi",
    "salesPerson": "John Sales",
    "trainingType": "PT",
    "trainer": "Coach Mike",
    "memberType": "New",
    "startingDate": "2026-03-21",
    "expiryDate": "2026-09-21"
  }')

echo "$RESPONSE" | jq '.'
MEMBER_ID=$(echo "$RESPONSE" | jq -r '.member._id')
echo ""
echo "Member ID: $MEMBER_ID"
echo ""

# Step 3: Get member's payments
echo "Step 3: Getting member payments..."
curl -s -X GET "http://localhost:3000/members/$MEMBER_ID/payments" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Step 4: Get all registered members
echo "Step 4: Getting all registered members..."
curl -s -X GET http://localhost:3000/members/register \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

---

## Field Descriptions

### Required Fields:
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `date` | String (ISO date) | Payment date | "2026-03-21" |
| `name` | String | Member full name | "John Smith" |
| `contactNumber` | String | Phone number (unique) | "9876543210" |
| `membershipMonths` | Number | Duration in months | 3, 6, 12 |
| `amount` | Number | Total membership amount | 6000 |
| `received` | Number | Amount received | 6000 or 4000 |
| `mop` | String | Mode of payment | "cash", "upi", "card", "bank_transfer" |
| `startingDate` | String (ISO date) | Membership start | "2026-03-21" |
| `expiryDate` | String (ISO date) | Membership expiry | "2026-09-21" |

### Optional Fields:
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `idNo` | String | Member ID number | "GYM-001" |
| `dob` | String (ISO date) | Date of birth | "1995-05-15" |
| `instagramHandle` | String | Instagram username | "@johnsmith" |
| `pending` | Number | Pending amount (auto-calculated) | 2000 |
| `transactionId` | String | Payment transaction ID | "UPI-123" |
| `salesPerson` | String | Sales person name | "Sarah Johnson" |
| `trainingType` | String | Training type | "PT", "GT" |
| `trainer` | String | Trainer name | "Mike Davis" |
| `memberType` | String | Member type | "New", "Renewal" |
| `memberStatus` | String | Member status | "ACTIVE" (default) |
| `address` | String | Address | "123 Street" |
| `emergencyContact` | String | Emergency phone | "9876543211" |

---

## Payment Modes (mop)

Supported payment modes:
- `"cash"` - Cash payment
- `"upi"` - UPI payment
- `"card"` - Card payment (Credit/Debit)
- `"bank_transfer"` - NEFT/RTGS/IMPS

---

## Auto-Calculations

### 1. Email Generation
If no email provided, auto-generated as:
```
member{contactNumber}@gym.com
```
Example: `member9876543210@gym.com`

### 2. Pending Amount
If `pending` not provided, auto-calculated as:
```
pending = amount - received
```
Example: amount=6000, received=4000 → pending=2000

### 3. Payment Notes
Auto-generated as:
```
"Initial payment for {membershipMonths} months membership"
```

---

## Validation Rules

1. **Contact Number Uniqueness:** Each contact number can only be registered once
2. **Membership Months:** Must be >= 1
3. **Amount:** Must be >= 0
4. **Received:** Must be >= 0
5. **Dates:** Must be valid ISO 8601 date strings

---

## Error Responses

### Duplicate Contact Number:
```json
{
  "message": "Member with contact number 9876543210 already exists",
  "error": "Conflict",
  "statusCode": 409
}
```

### Validation Error:
```json
{
  "message": [
    "name should not be empty",
    "amount must be a number conforming to the specified constraints"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### Unauthorized:
```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

---

## Testing with Postman

1. **Create Collection:** "Gym - Simplified Flow"
2. **Set Environment Variable:** `{{token}}` = Your access token
3. **Import these endpoints:**
   - POST `/auth/admin/login`
   - POST `/members/register`
   - GET `/members/register`
   - GET `/members/:id/payments`

---

## Production Deployment

When deploying to production, replace:
```bash
http://localhost:3000
```

With your production URL:
```bash
https://your-domain.com
```

Or:
```bash
https://gymcrmbackend-8kx6.onrender.com
```

---

## Complete Working Example

Save this as `test-member-registration.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"

# Login
TOKEN=$(curl -s -X POST $BASE_URL/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@backendgym.com","password":"Admin@123"}' | \
  jq -r '.tokens.accessToken')

# Register member
curl -X POST $BASE_URL/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "idNo": "GYM-TEST-001",
    "date": "2026-03-21",
    "name": "Test Member",
    "contactNumber": "9999999999",
    "membershipMonths": 3,
    "amount": 3000,
    "received": 3000,
    "mop": "cash",
    "salesPerson": "Test Sales",
    "trainingType": "GT",
    "trainer": "Test Trainer",
    "memberType": "New",
    "startingDate": "2026-03-21",
    "expiryDate": "2026-06-21"
  }' | jq '.'
```

Make executable and run:
```bash
chmod +x test-member-registration.sh
./test-member-registration.sh
```

---

**Created:** March 21, 2026
**Last Updated:** March 21, 2026
**API Version:** v1.0
