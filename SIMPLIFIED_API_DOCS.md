# Gym CRM - Simplified Flow API Documentation

**Quick Registration Flow** - Register members with embedded membership and payment in one API call.

---

## Base URL
```
http://localhost:3000
```
Production: `https://gymcrmbackend-8kx6.onrender.com`

---

## Authentication

All endpoints require JWT authentication.

### Login
```bash
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

Use the `accessToken` in all subsequent requests:
```
Authorization: Bearer <accessToken>
```

---

## API Endpoints

### 1. Register New Member

Register a member with membership and payment in **one API call**.

**Endpoint:** `POST /members/register`

**Request Body:**
```json
{
  "idNo": "GYM-2026-001",
  "date": "2026-03-21",
  "name": "Alex Johnson",
  "contactNumber": "5551234567",
  "dob": "1992-03-15",
  "instagramHandle": "@alexj_fit",
  "membershipMonths": 12,
  "amount": 12000,
  "received": 12000,
  "mop": "card",
  "transactionId": "CARD-2026-001",
  "salesPerson": "Emily Sales",
  "trainingType": "PT",
  "trainer": "Coach Ryan",
  "memberType": "New",
  "startingDate": "2026-03-21",
  "expiryDate": "2027-03-21",
  "memberStatus": "ACTIVE",
  "address": "123 Fitness Street",
  "emergencyContact": "5551111111"
}
```

**Required Fields:**
- `date` - Payment date (YYYY-MM-DD)
- `name` - Member full name
- `contactNumber` - Phone number (must be unique)
- `membershipMonths` - Duration in months (≥ 1)
- `amount` - Total membership amount
- `received` - Amount received
- `mop` - Payment mode: `cash`, `upi`, `card`, `bank_transfer`
- `startingDate` - Membership start date
- `expiryDate` - Membership expiry date

**Optional Fields:**
- `idNo` - Member ID number
- `dob` - Date of birth
- `instagramHandle` - Instagram handle
- `pending` - Pending amount (auto-calculated if not provided)
- `transactionId` - Transaction reference
- `salesPerson` - Sales person name
- `trainingType` - Training type (PT, GT)
- `trainer` - Trainer name
- `memberType` - Member type (New, Renewal)
- `memberStatus` - Status (ACTIVE, INACTIVE, SUSPENDED)
- `address` - Address
- `emergencyContact` - Emergency contact number

**Auto-calculations:**
- Email: `member{contactNumber}@gym.com`
- Pending: `amount - received` (if not provided)
- Notes: `Initial payment for {membershipMonths} months membership`

**Response (201 Created):**
```json
{
  "member": {
    "_id": "69be51a3337375e4f02b91fe",
    "email": "member5551234567@gym.com",
    "name": "Alex Johnson",
    "phone": "5551234567",
    "idNo": "GYM-2026-001",
    "membershipMonths": 12,
    "startingDate": "2026-03-21T00:00:00.000Z",
    "expiryDate": "2027-03-21T00:00:00.000Z",
    "membershipAmount": 12000,
    "memberStatus": "ACTIVE",
    "trainer": "Coach Ryan"
  },
  "payment": {
    "_id": "69be51a3337375e4f02b9200",
    "memberId": "69be51a3337375e4f02b91fe",
    "amount": 12000,
    "received": 12000,
    "pending": 0,
    "mop": "card",
    "paymentDate": "2026-03-21T00:00:00.000Z",
    "transactionId": "CARD-2026-001"
  }
}
```

**cURL:**
```bash
curl -X POST http://localhost:3000/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "date": "2026-03-21",
    "name": "Alex Johnson",
    "contactNumber": "5551234567",
    "membershipMonths": 12,
    "amount": 12000,
    "received": 12000,
    "mop": "card",
    "startingDate": "2026-03-21",
    "expiryDate": "2027-03-21"
  }'
```

---

### 2. Get All Registered Members

Get all members with **pagination and search**.

**Endpoint:** `GET /members/register`

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page, max 100 (default: 10)
- `search` (optional) - Search by name, email, phone, or ID number
- `sortBy` (optional) - Field to sort by (default: createdAt)
- `sortOrder` (optional) - Sort order: `asc` or `desc` (default: desc)

**Examples:**
```bash
# Get first page (10 members)
GET /members/register

# Get page 2 with 20 members
GET /members/register?page=2&limit=20

# Search for "john"
GET /members/register?search=john

# Search and paginate
GET /members/register?search=alex&page=1&limit=10

# Sort by name ascending
GET /members/register?sortBy=name&sortOrder=asc
```

**Response (200 OK):**
```json
{
  "data": [
    {
      "_id": "69be51a3337375e4f02b91fe",
      "email": "member5551234567@gym.com",
      "name": "Alex Johnson",
      "phone": "5551234567",
      "idNo": "GYM-2026-001",
      "membershipMonths": 12,
      "startingDate": "2026-03-21T00:00:00.000Z",
      "expiryDate": "2027-03-21T00:00:00.000Z",
      "membershipAmount": 12000,
      "memberStatus": "ACTIVE",
      "trainer": "Coach Ryan"
    }
  ],
  "pagination": {
    "total": 50,
    "page": 1,
    "limit": 10,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

**cURL:**
```bash
# Basic
curl -X GET http://localhost:3000/members/register \
  -H "Authorization: Bearer <token>"

# With search
curl -X GET "http://localhost:3000/members/register?search=john&page=1&limit=20" \
  -H "Authorization: Bearer <token>"
```

---

### 3. Get All Payments

Get all payments with **pagination and search**.

**Endpoint:** `GET /members/payments`

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page, max 100 (default: 10)
- `search` (optional) - Search by member name, phone, email, transaction ID, or notes
- `sortBy` (optional) - Field to sort by (default: paymentDate)
- `sortOrder` (optional) - Sort order: `asc` or `desc` (default: desc)

**Examples:**
```bash
# Get recent payments
GET /members/payments

# Search by member name or transaction ID
GET /members/payments?search=john

# Get page 2
GET /members/payments?page=2&limit=20

# Sort by amount descending
GET /members/payments?sortBy=amount&sortOrder=desc
```

**Response (200 OK):**
```json
{
  "data": [
    {
      "_id": "69be51a3337375e4f02b9200",
      "memberId": {
        "_id": "69be51a3337375e4f02b91fe",
        "name": "Alex Johnson",
        "email": "member5551234567@gym.com",
        "phone": "5551234567"
      },
      "amount": 12000,
      "received": 12000,
      "pending": 0,
      "mop": "card",
      "paymentDate": "2026-03-21T00:00:00.000Z",
      "transactionId": "CARD-2026-001",
      "notes": "Initial payment for 12 months membership"
    }
  ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

**cURL:**
```bash
# Basic
curl -X GET http://localhost:3000/members/payments \
  -H "Authorization: Bearer <token>"

# With search
curl -X GET "http://localhost:3000/members/payments?search=CARD&page=1" \
  -H "Authorization: Bearer <token>"
```

---

### 4. Create Additional Payment

Create a new payment for an existing member (renewals, partial payments, etc.).

**Endpoint:** `POST /members/payments`

**Request Body (Basic Payment):**
```json
{
  "memberId": "69be51a3337375e4f02b91fe",
  "amount": 1000,
  "received": 1000,
  "mop": "cash",
  "paymentDate": "2026-06-21",
  "notes": "Partial payment"
}
```

**Request Body (Renewal Payment - Updates Member Data):**
```json
{
  "memberId": "69be51a3337375e4f02b91fe",
  "amount": 3000,
  "received": 3000,
  "mop": "upi",
  "paymentDate": "2026-06-21",
  "transactionId": "UPI-RENEWAL-001",
  "notes": "3-month renewal payment",
  "renewalMonths": 3,
  "newExpiryDate": "2027-06-21"
}
```

**Required Fields:**
- `memberId` - Member ID (must exist)
- `amount` - Total amount
- `received` - Amount received
- `mop` - Payment mode: `cash`, `upi`, `card`, `bank_transfer`
- `paymentDate` - Payment date (YYYY-MM-DD)

**Optional Fields:**
- `pending` - Pending amount (auto-calculated if not provided: amount - received)
- `transactionId` - Transaction reference
- `notes` - Payment notes (default: "Additional payment")
- `renewalMonths` - Number of months to extend membership (updates member's expiryDate and membershipMonths)
- `newExpiryDate` - New expiry date (YYYY-MM-DD) - if provided, overrides renewalMonths calculation

**Response (201 Created):**
```json
{
  "payment": {
    "_id": "69be52b0337375e4f02b9210",
    "memberId": "69be51a3337375e4f02b91fe",
    "amount": 3000,
    "received": 3000,
    "pending": 0,
    "mop": "upi",
    "paymentDate": "2026-06-21T00:00:00.000Z",
    "transactionId": "UPI-RENEWAL-001",
    "notes": "3-month renewal payment",
    "createdAt": "2026-06-21T10:30:00.000Z",
    "updatedAt": "2026-06-21T10:30:00.000Z"
  },
  "member": {
    "_id": "69be51a3337375e4f02b91fe",
    "name": "Alex Johnson",
    "phone": "5551234567",
    "membershipMonths": 15,
    "expiryDate": "2027-06-21T00:00:00.000Z",
    "membershipAmount": 15000
  }
}
```

**How Renewal Works:**
- If `renewalMonths` is provided:
  - Adds months to current `expiryDate`
  - Increments `membershipMonths`
  - Adds payment amount to `membershipAmount`
- If `newExpiryDate` is provided:
  - Sets `expiryDate` to the specified date
  - Adds payment amount to `membershipAmount`
- Member data is automatically updated in the database

**Use Cases:**
- ✅ Renewal payments
- ✅ Partial payments (when member pays in installments)
- ✅ Additional services/PT sessions
- ✅ Locker fees
- ✅ Any subsequent payment after initial registration

**cURL (Basic Payment):**
```bash
curl -X POST http://localhost:3000/members/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "memberId": "69be51a3337375e4f02b91fe",
    "amount": 1000,
    "received": 1000,
    "mop": "cash",
    "paymentDate": "2026-06-21",
    "notes": "Partial payment"
  }'
```

**cURL (Renewal Payment - Updates Member):**
```bash
curl -X POST http://localhost:3000/members/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "memberId": "69be51a3337375e4f02b91fe",
    "amount": 3000,
    "received": 3000,
    "mop": "upi",
    "paymentDate": "2026-06-21",
    "transactionId": "UPI-RENEWAL-001",
    "notes": "3-month renewal",
    "renewalMonths": 3
  }'
```

**Error Response - Member Not Found (404):**
```json
{
  "message": "Member with ID 69be51a3337375e4f02b91fe not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

### 5. Get Member's Payment History

Get all payments for a specific member.

**Endpoint:** `GET /members/:id/payments`

**Path Parameters:**
- `id` (required) - Member ID

**Response (200 OK):**
```json
[
  {
    "_id": "69be51a3337375e4f02b9200",
    "memberId": "69be51a3337375e4f02b91fe",
    "amount": 12000,
    "received": 12000,
    "pending": 0,
    "mop": "card",
    "paymentDate": "2026-03-21T00:00:00.000Z",
    "transactionId": "CARD-2026-001",
    "notes": "Initial payment for 12 months membership"
  },
  {
    "_id": "69be52b0337375e4f02b9210",
    "memberId": "69be51a3337375e4f02b91fe",
    "amount": 3000,
    "received": 3000,
    "pending": 0,
    "mop": "upi",
    "paymentDate": "2026-06-21T00:00:00.000Z",
    "transactionId": "UPI-RENEWAL-001",
    "notes": "Renewal payment"
  }
]
```

**cURL:**
```bash
curl -X GET http://localhost:3000/members/69be51a3337375e4f02b91fe/payments \
  -H "Authorization: Bearer <token>"
```

---

## Payment Modes

Supported payment modes (`mop` field):
- `cash` - Cash payment
- `upi` - UPI payment
- `card` - Card payment (Credit/Debit)
- `bank_transfer` - NEFT/RTGS/IMPS

---

## Member Status

- `ACTIVE` - Member is active (default)
- `INACTIVE` - Member is inactive
- `SUSPENDED` - Member is temporarily suspended

---

## Error Responses

### Duplicate Contact Number (409 Conflict)
```json
{
  "message": "Member with contact number 5551234567 already exists",
  "error": "Conflict",
  "statusCode": 409
}
```

### Validation Error (400 Bad Request)
```json
{
  "message": [
    "name should not be empty",
    "membershipMonths must not be less than 1"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

### Unauthorized (401)
```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

### Not Found (404)
```json
{
  "message": "Member with ID 69be51a3337375e4f02b91fe not found",
  "error": "Not Found",
  "statusCode": 404
}
```

---

## Complete Example Flow

```bash
#!/bin/bash

# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3000/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@backendgym.com","password":"Admin@123"}' | \
  jq -r '.tokens.accessToken')

echo "Token: $TOKEN"

# 2. Register a member
RESPONSE=$(curl -s -X POST http://localhost:3000/members/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "date": "2026-03-21",
    "name": "John Smith",
    "contactNumber": "9876543210",
    "membershipMonths": 6,
    "amount": 6000,
    "received": 6000,
    "mop": "cash",
    "startingDate": "2026-03-21",
    "expiryDate": "2026-09-21"
  }')

echo "$RESPONSE" | jq '.'
MEMBER_ID=$(echo "$RESPONSE" | jq -r '.member._id')

# 3. Get all members (with pagination)
curl -s -X GET "http://localhost:3000/members/register?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# 4. Create additional payment (renewal)
curl -s -X POST http://localhost:3000/members/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"memberId\": \"$MEMBER_ID\",
    \"amount\": 3000,
    \"received\": 3000,
    \"mop\": \"upi\",
    \"paymentDate\": \"2026-06-21\",
    \"transactionId\": \"UPI-RENEWAL-001\",
    \"notes\": \"3-month renewal\"
  }" | jq '.'

# 5. Get member's payments
curl -s -X GET "http://localhost:3000/members/$MEMBER_ID/payments" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# 6. Search payments
curl -s -X GET "http://localhost:3000/members/payments?search=john" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

---

### 6. Bulk Import from Excel

Import multiple members at once from an Excel file.

**Endpoint:** `POST /members/import`

**Content-Type:** `multipart/form-data`

**File Format Requirements:**
- Excel file (.xlsx or .xls)
- Required columns:
  - `ID. NO` - Unique member ID (e.g., DLF-001)
  - `Date` - Registration date
  - `Client Name` - Full name
  - `Phone Number` - Contact number (unique)
  - `PACKAGE` - Membership duration (e.g., 1MONTH, 3MONTH, 6MONTH, 12MONTH)
  - `AMOUNT` - Membership amount
  - `RECEIVED` - Amount received
  - `BAL AMOUNT` - Pending amount (use "NIL" for zero)
  - `MOP` - Mode of payment (CASH, SCAN/UPI, CARD, BANK)
  - `STARTING DATE` - Membership start date
  - `EXPIRY DATE` - Membership expiry date

- Optional columns:
  - `DOB` - Date of birth
  - `INSTAGRAM` - Instagram handle
  - `SALES` - Sales person name
  - `TRAINING TYPE` - GT, PT, SELF, etc.
  - `Trainer assigned` - Trainer name
  - `MEMBER TYPE` - NEW, OLD, etc.

**Response (201 Created):**
```json
{
  "success": 13,
  "failed": 1,
  "errors": [
    {
      "row": 13,
      "name": "JOHN DOE",
      "error": "Member with phone 9999999999 already exists"
    }
  ],
  "imported": [
    {
      "member": { ... },
      "payment": { ... }
    }
  ]
}
```

**Success/Error Tracking:**
- `success` - Number of successfully imported members
- `failed` - Number of failed imports
- `errors` - Array of errors with row number, name, and error message
- `imported` - Array of successfully imported member+payment pairs

**cURL:**
```bash
curl -X POST http://localhost:3000/members/import \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/members.xlsx"
```

**JavaScript Example:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('http://localhost:3000/members/import', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
})
.then(res => res.json())
.then(data => {
  console.log(`Success: ${data.success}, Failed: ${data.failed}`);
  if (data.errors.length > 0) {
    console.error('Errors:', data.errors);
  }
});
```

**Notes:**
- Duplicate phone numbers are automatically detected and skipped
- Each row is processed independently - errors don't stop the import
- Invalid package formats (typos) are handled gracefully
- Dates support multiple formats: Excel serial dates, M/D/YYYY, YYYY-MM-DD
- MOP values are normalized (e.g., "SCAN" → "upi", "CASH" → "cash")
- Auto-generated emails use format: `member{phoneNumber}@gym.com`

---

## Advantages of Simplified Flow

✅ **One API call** for complete registration
✅ **No plan templates** needed - direct months-based pricing
✅ **Payment = Invoice** - single entity, simpler tracking
✅ **Auto-calculations** - email, pending amount, notes
✅ **Fast onboarding** - minimal steps
✅ **Pagination & Search** - built-in for all list endpoints
✅ **Flexible** - custom pricing per member

---

## Tips

1. **Pagination**: Always use pagination for large datasets. Default is 10 items per page.

2. **Search**: Search works across multiple fields:
   - Members: name, email, phone, ID number
   - Payments: member name/phone/email, transaction ID, notes

3. **Sorting**: You can sort by any field:
   - Members: `name`, `createdAt`, `membershipAmount`, `expiryDate`
   - Payments: `paymentDate`, `amount`, `received`, `pending`

4. **Contact Uniqueness**: Each phone number can only be registered once.

5. **Token Expiry**: Access tokens expire after 7 days. Use refresh token to get a new one.

---

**API Version:** v1.0
**Last Updated:** March 21, 2026
**Documentation:** Simplified Flow Only
