# Environment Variables Setup Guide

## Understanding NODE_ENV

`NODE_ENV` tells your application what environment it's running in. This affects:
- Database connections
- Logging levels
- Security settings
- Token expiration times

---

## Current Setup (Simple - Single .env File)

Your current `.env` file:
```env
NODE_ENV=development
MONGODB_URI=mongodb+srv://testuser:newhai@testcluster.xenkdyc.mongodb.net/backendgym
JWT_ACCESS_SECRET=your-access-secret-key-change-this-in-production
```

**This is already working!** The app reads this file automatically.

---

## Recommended Setup (Multiple Environment Files)

### Step 1: Create Environment-Specific Files

```bash
# Create files
touch .env.development
touch .env.production
```

### Step 2: Configure Each File

**.env.development** (Local development):
```env
NODE_ENV=development
PORT=3000

# Local MongoDB
MONGODB_URI=mongodb://localhost:27017/backendgym

# Or your cloud MongoDB for testing
# MONGODB_URI=mongodb+srv://testuser:newhai@testcluster.xenkdyc.mongodb.net/backendgym

# JWT - Longer expiry for development convenience
JWT_ACCESS_SECRET=dev-secret-key-12345
JWT_ACCESS_EXPIRATION=7d
JWT_REFRESH_SECRET=dev-refresh-secret-12345
JWT_REFRESH_EXPIRATION=365d
```

**.env.production** (Production deployment):
```env
NODE_ENV=production
PORT=3000

# Production MongoDB (use your production cluster)
MONGODB_URI=mongodb+srv://produser:prodpassword@prodcluster.mongodb.net/backendgym

# JWT - Shorter expiry for security
JWT_ACCESS_SECRET=super-secure-random-secret-generate-this-properly
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_SECRET=super-secure-refresh-secret-generate-this-properly
JWT_REFRESH_EXPIRATION=7d
```

**.env** (Default fallback - optional):
```env
# This file is read if no environment-specific file exists
PORT=3000
```

### Step 3: Update app.module.ts

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Automatically load based on NODE_ENV
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    // ... other imports
  ],
})
export class AppModule {}
```

### Step 4: Run with Different Environments

```bash
# Development (default)
npm run start:dev

# Production
NODE_ENV=production npm run start:prod

# Or using cross-env (works on Windows too)
npm install -D cross-env
cross-env NODE_ENV=production npm run start:prod
```

---

## How Environment Variables Are Loaded

### Priority Order:
1. **Environment-specific file** (`.env.development` or `.env.production`)
2. **Default file** (`.env`)
3. **System environment variables**

### Example:
```bash
# Running in development
NODE_ENV=development npm run start:dev
# Loads: .env.development

# Running in production
NODE_ENV=production npm run start:prod
# Loads: .env.production
```

---

## Security Best Practices

### ✅ DO:
- Use different secrets for development and production
- Generate strong random secrets for production:
  ```bash
  # Generate secure random string
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Keep production secrets secret (never commit them)
- Use short token expiration in production (15min access, 7d refresh)

### ❌ DON'T:
- Use the same secrets in dev and production
- Commit `.env` files to git (add to `.gitignore`)
- Use weak secrets like "your-secret-key"
- Use long token expiration in production

---

## Current Configuration Check

Your app is currently using:
```env
NODE_ENV=development
MONGODB_URI=mongodb+srv://testuser:newhai@testcluster.xenkdyc.mongodb.net/backendgym
JWT_ACCESS_SECRET=your-access-secret-key-change-this-in-production
JWT_ACCESS_EXPIRATION=7d
JWT_REFRESH_EXPIRATION=365d
```

**Status:** ✅ Working, but secrets need to be changed for production!

---

## Quick Commands Reference

```bash
# Check current NODE_ENV
echo $NODE_ENV

# Run in development
npm run start:dev

# Run in production
NODE_ENV=production npm run start:prod

# Generate secure secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# View loaded environment variables (in your app)
# Add this to any controller temporarily:
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('MONGODB_URI:', process.env.MONGODB_URI);
```

---

## Deployment Checklist

Before deploying to production:

- [ ] Set `NODE_ENV=production`
- [ ] Change JWT secrets to secure random strings
- [ ] Use production MongoDB URI
- [ ] Set shorter token expiration (15min access)
- [ ] Enable HTTPS
- [ ] Add rate limiting
- [ ] Set up monitoring
- [ ] Never expose `.env` files

---

## Example: Switching Environments

### Development Mode (Current):
```bash
npm run start:dev
# Uses: NODE_ENV=development
# MongoDB: Cloud database (testcluster)
# Tokens: Long expiry (7d access, 365d refresh)
```

### Production Mode:
```bash
NODE_ENV=production npm run start:prod
# Uses: NODE_ENV=production
# MongoDB: Production database
# Tokens: Short expiry (15min access, 7d refresh)
```

---

## What's Different Between Environments?

| Feature | Development | Production |
|---------|-------------|------------|
| NODE_ENV | development | production |
| MongoDB | Local or test cluster | Production cluster |
| JWT Access Token | 7 days (convenience) | 15 minutes (security) |
| JWT Refresh Token | 365 days | 7 days |
| Logging | Verbose | Error-only |
| Secrets | Simple/weak | Strong random |
| CORS | All origins | Specific origins |

---

## Your Current Setup Is Fine For Development!

You don't need to change anything right now. The `.env` file is already working.

Just remember to:
1. **Change secrets before production deployment**
2. **Use production MongoDB URI in production**
3. **Set shorter token expiration in production**

---

## Need Help?

If you see errors like:
- "Cannot connect to MongoDB" → Check MONGODB_URI
- "Invalid token" → Check JWT secrets
- "Environment variable undefined" → Check .env file exists and is loaded

Run this to debug:
```bash
# Check what environment variables are loaded
node -e "require('dotenv').config(); console.log(process.env)"
```
