# Backend GYM - API Documentation

## Authentication Endpoints

Base URL: `http://localhost:3000`

### 1. Admin Login

Login endpoint for admin users only. Returns access token (15 min expiry) and refresh token (7 days expiry).

**Endpoint:** `POST /auth/admin/login`

**Request Body:**
```json
{
  "email": "admin@backendgym.com",
  "password": "Admin@123"
}
```

**Success Response (200):**
```json
{
  "user": {
    "userId": "uuid-here",
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

**Error Responses:**
- `401 Unauthorized` - Invalid credentials
- `401 Unauthorized` - Access denied. Admin privileges required (if user is not admin)
- `401 Unauthorized` - Account is inactive

---

### 2. Refresh Token

Generate new access and refresh tokens using the refresh token.

**Endpoint:** `POST /auth/refresh`

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses:**
- `401 Unauthorized` - Access denied (invalid or expired refresh token)

---

### 3. Logout

Logout the current user by invalidating their refresh token.

**Endpoint:** `POST /auth/logout`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Success Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid or expired access token

---

## RBAC (Role-Based Access Control)

### Available Roles

The system supports the following roles (ordered by permission level):

1. **SUPER_ADMIN** - Highest level of access
2. **ADMIN** - Administrative access
3. **MANAGER** - Management level access
4. **USER** - Basic user access

### Using Role Guards

To protect routes based on roles, use the `@Roles()` decorator with `@UseGuards()`:

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { Roles } from './common/decorators/roles.decorator';
import { Role } from './common/enums/role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Get('admin-only')
adminOnlyRoute() {
  return 'This is only accessible by admins';
}
```

### Getting Current User

Use the `@CurrentUser()` decorator to get the authenticated user's information:

```typescript
import { CurrentUser } from './common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Get('profile')
getProfile(@CurrentUser() user: any) {
  // user contains: userId, email, role, name
  return user;
}

// Or get specific field
@Get('my-email')
getMyEmail(@CurrentUser('email') email: string) {
  return { email };
}
```

---

## JWT Payload Structure

### Access Token Payload
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "ADMIN",
  "name": "User Name",
  "iat": 1234567890,
  "exp": 1234568790
}
```

### Refresh Token Payload
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1235172690
}
```

---

## Database Schema

### Users Table

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  role ENUM('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER') DEFAULT 'USER',
  is_active BOOLEAN DEFAULT true,
  refresh_token VARCHAR NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## Environment Variables

Required environment variables in `.env`:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
DATABASE_NAME=backendgym

# JWT Access Token (short-lived)
JWT_ACCESS_SECRET=your-access-secret-key
JWT_ACCESS_EXPIRATION=15m

# JWT Refresh Token (long-lived)
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_REFRESH_EXPIRATION=7d
```

---

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your database credentials
```

### 3. Setup PostgreSQL Database
```bash
# Create database
createdb backendgym

# Or using psql
psql -U postgres
CREATE DATABASE backendgym;
```

### 4. Run Database Migrations
The application uses TypeORM with `synchronize: true` in development, so tables will be created automatically.

### 5. Seed Admin User
```bash
npm run seed
```

This will create an admin user with:
- **Email:** admin@backendgym.com
- **Password:** Admin@123
- **Role:** ADMIN

### 6. Start the Server
```bash
# Development mode with hot reload
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

---

## Testing the API

### Using cURL

#### 1. Admin Login
```bash
curl -X POST http://localhost:3000/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@backendgym.com",
    "password": "Admin@123"
  }'
```

#### 2. Access Protected Route
```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### 3. Refresh Tokens
```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

### Using Postman

1. Import the endpoints into Postman
2. Create an environment variable for `accessToken`
3. Use `{{accessToken}}` in the Authorization header

---

## Security Features

1. **Password Hashing**: All passwords are hashed using bcrypt (10 salt rounds)
2. **Refresh Token Storage**: Refresh tokens are hashed before storing in database
3. **JWT Validation**: All protected routes validate JWT tokens
4. **Role-Based Access**: Fine-grained access control using role guards
5. **CORS Enabled**: Cross-origin requests are supported
6. **Input Validation**: All inputs are validated using class-validator
7. **Token Expiry**: Access tokens expire in 15 minutes, refresh tokens in 7 days

---

## Error Handling

All errors follow a consistent format:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

Common HTTP status codes:
- `200 OK` - Request succeeded
- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Authentication failed
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error
