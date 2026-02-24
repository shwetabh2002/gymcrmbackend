# MongoDB Setup Guide - Backend GYM

## What is MongoDB?

MongoDB is a **NoSQL database** that stores data in flexible, JSON-like documents. Unlike PostgreSQL (which uses tables and rows), MongoDB uses collections and documents, making it easier to work with and doesn't require complex setup.

### Key Differences from PostgreSQL:

| Feature | PostgreSQL | MongoDB |
|---------|-----------|---------|
| Type | SQL (Relational) | NoSQL (Document) |
| Data Structure | Tables with rows | Collections with documents |
| Schema | Strict, predefined | Flexible, dynamic |
| Setup | Complex | Simple |
| Query Language | SQL | JavaScript-like |

---

## Prerequisites

- **Node.js** v22+ ✅ Already installed
- **MongoDB** (we'll install this)

---

## Step 1: Install MongoDB

### macOS (using Homebrew)

```bash
# Install MongoDB Community Edition
brew tap mongodb/brew
brew install mongodb-community

# Start MongoDB service
brew services start mongodb-community

# Verify MongoDB is running
brew services list | grep mongodb
```

### Alternative: Using Docker (Easier!)

If you have Docker installed:

```bash
# Run MongoDB in a container
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_DATABASE=backendgym \
  mongo:latest

# Verify it's running
docker ps | grep mongodb
```

---

## Step 2: Verify MongoDB Connection

```bash
# Connect to MongoDB shell
mongosh

# Or if using Docker
docker exec -it mongodb mongosh

# In the MongoDB shell:
show dbs
use backendgym
exit
```

---

## Step 3: Configure Environment

Your `.env` file is already configured with:

```env
MONGODB_URI=mongodb://localhost:27017/backendgym
```

**No password or username needed for local development!**

---

## Step 4: Start the Application

```bash
# Start the NestJS server
npm run start:dev
```

The application will:
- Connect to MongoDB automatically
- Create the `users` collection automatically
- Start on port 3000

---

## Step 5: Seed Admin User

In a **new terminal** window:

```bash
npm run seed
```

This creates:
- **Email:** admin@backendgym.com
- **Password:** Admin@123
- **Role:** ADMIN

---

## Step 6: Test Admin Login

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
    "userId": "507f1f77bcf86cd799439011",
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

---

## MongoDB Commands (Optional)

### View Data in MongoDB

```bash
# Connect to MongoDB
mongosh

# Switch to your database
use backendgym

# View all users
db.users.find().pretty()

# Count users
db.users.countDocuments()

# Find admin user
db.users.findOne({ email: "admin@backendgym.com" })

# Delete all users (if you want to start fresh)
db.users.deleteMany({})
```

### Stop MongoDB

```bash
# If using Homebrew
brew services stop mongodb-community

# If using Docker
docker stop mongodb
docker rm mongodb
```

---

## Troubleshooting

### MongoDB Not Running

**Error:** `MongoServerError: connect ECONNREFUSED`

**Solution:**
```bash
# Check if MongoDB is running
brew services list | grep mongodb

# If not running, start it
brew services start mongodb-community

# Or restart
brew services restart mongodb-community
```

### Port 27017 Already in Use

**Solution:**
```bash
# Find what's using the port
lsof -ti:27017

# Kill the process
lsof -ti:27017 | xargs kill -9

# Start MongoDB again
brew services start mongodb-community
```

### Can't Connect to MongoDB

**Solution:**
Check your `.env` file has the correct URI:
```env
MONGODB_URI=mongodb://localhost:27017/backendgym
```

---

## Why MongoDB is Easier Than PostgreSQL

1. **No User/Password Setup** - Works out of the box
2. **No Database Creation** - Auto-created when you connect
3. **No Schema Management** - Flexible structure
4. **JSON-like Data** - Easier to work with in JavaScript/TypeScript
5. **Single Command Install** - No complex configuration

---

## MongoDB with Docker (Recommended for Production)

For production or consistent dev environment:

```bash
# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  mongodb:
    image: mongo:latest
    container_name: backendgym-mongo
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_DATABASE: backendgym
    volumes:
      - mongodb_data:/data/db

volumes:
  mongodb_data:
EOF

# Start MongoDB
docker-compose up -d

# Stop MongoDB
docker-compose down
```

---

## Project Changes from PostgreSQL

### What Changed:

1. **Dependencies:**
   - ❌ Removed: `@nestjs/typeorm`, `typeorm`, `pg`
   - ✅ Added: `@nestjs/mongoose`, `mongoose`

2. **User Schema:**
   - ❌ Was: TypeORM Entity with decorators
   - ✅ Now: Mongoose Schema with `@Prop()` decorators

3. **Database Connection:**
   - ❌ Was: PostgreSQL connection string with username/password
   - ✅ Now: Simple MongoDB URI

4. **User ID:**
   - ❌ Was: UUID (e.g., `550e8400-e29b-41d4-a716-446655440000`)
   - ✅ Now: MongoDB ObjectId (e.g., `507f1f77bcf86cd799439011`)

---

## Quick Start Summary

```bash
# 1. Install MongoDB
brew install mongodb-community
brew services start mongodb-community

# 2. Start the app
npm run start:dev

# 3. Seed admin user
npm run seed

# 4. Test login
curl -X POST http://localhost:3000/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@backendgym.com","password":"Admin@123"}'
```

---

## Next Steps

- Read the [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for complete API reference
- The authentication flow is **identical** to the PostgreSQL version
- All endpoints work exactly the same way
- The only difference is the database backend!

---

**Note:** All features (RBAC, JWT, admin login, refresh tokens) work exactly as before. The migration to MongoDB was seamless!
