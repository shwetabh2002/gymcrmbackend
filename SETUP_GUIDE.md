# Quick Setup Guide - Backend GYM

## Prerequisites

Before running this application, ensure you have:

1. **Node.js** (v22 or higher) ✅ Already installed
2. **PostgreSQL** (v12 or higher)
3. **npm** ✅ Already installed

## Step 1: Install PostgreSQL

### macOS (using Homebrew)
```bash
brew install postgresql@15
brew services start postgresql@15
```

### Create Database
```bash
# Using createdb command
createdb backendgym

# Or using psql
psql postgres
CREATE DATABASE backendgym;
\q
```

## Step 2: Configure Environment Variables

The `.env` file has been created. Update the database credentials:

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=          # Add your PostgreSQL password here
DATABASE_NAME=backendgym
```

## Step 3: Run the Application

```bash
# Start the server (tables will be created automatically)
npm run start:dev
```

The application will:
- Connect to PostgreSQL
- Create the `users` table automatically (using TypeORM synchronize)
- Start the server on port 3000

## Step 4: Seed Admin User

In a new terminal window:

```bash
npm run seed
```

This creates an admin user:
- **Email:** admin@backendgym.com
- **Password:** Admin@123

## Step 5: Test the API

### Test Admin Login
```bash
curl -X POST http://localhost:3000/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@backendgym.com",
    "password": "Admin@123"
  }'
```

Expected response:
```json
{
  "user": {
    "userId": "...",
    "email": "admin@backendgym.com",
    "name": "Admin User",
    "role": "ADMIN"
  },
  "tokens": {
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

## Troubleshooting

### PostgreSQL Connection Issues

1. **Check if PostgreSQL is running:**
   ```bash
   brew services list | grep postgresql
   # or
   pg_isready
   ```

2. **Check PostgreSQL port:**
   ```bash
   psql -U postgres -h localhost
   ```

3. **Reset PostgreSQL password (if needed):**
   ```bash
   psql postgres
   ALTER USER postgres PASSWORD 'newpassword';
   ```

### Database Not Created

```bash
# Check existing databases
psql -U postgres -l

# Create manually if needed
psql -U postgres
CREATE DATABASE backendgym;
GRANT ALL PRIVILEGES ON DATABASE backendgym TO postgres;
```

### Port 3000 Already in Use

Change the `PORT` in `.env` file:
```env
PORT=3001
```

## Project Structure

```
backendgym/
├── src/
│   ├── auth/                  # Authentication module
│   │   ├── dto/              # Data Transfer Objects
│   │   ├── guards/           # JWT & Role guards
│   │   ├── strategies/       # JWT strategies
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── auth.module.ts
│   ├── users/                 # Users module
│   │   ├── entities/         # User entity
│   │   ├── users.service.ts
│   │   └── users.module.ts
│   ├── common/               # Shared resources
│   │   ├── decorators/       # Custom decorators
│   │   └── enums/            # Enums (Role)
│   ├── database/             # Database utilities
│   │   └── seeders/          # Seed scripts
│   ├── app.module.ts
│   └── main.ts
├── .env                       # Environment variables
├── package.json
└── API_DOCUMENTATION.md       # Full API docs
```

## Next Steps

After successful setup:

1. Read the [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for detailed API usage
2. Test all endpoints using cURL or Postman
3. Implement additional features:
   - User registration
   - Password reset
   - Email verification
   - Additional RBAC protected routes
   - Audit logging

## Available Scripts

```bash
npm run start:dev    # Start with hot reload
npm run start        # Start in production mode
npm run build        # Build the project
npm run seed         # Seed admin user
npm test             # Run tests
npm run lint         # Lint code
```

## Default Admin Credentials

⚠️ **Important:** Change these credentials in production!

- **Email:** admin@backendgym.com
- **Password:** Admin@123
- **Role:** ADMIN

## Support

For issues or questions, refer to:
- [NestJS Documentation](https://docs.nestjs.com)
- [TypeORM Documentation](https://typeorm.io)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
