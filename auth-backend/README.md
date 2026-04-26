# PicTur Auth Backend API

Authentication Backend API for PicTur with user management and Google OAuth.

## Overview

This is a **separate authentication service** that handles:

- User registration and login
- Google OAuth integration
- Role-based access control (community/admin)
- User management for admins
- Email notifications for admin promotions and invitations

The turtle identification backend is in the `backend/` folder and is developed by a separate team.

## Setup

### 1. Install Dependencies

```bash
npm install
```

**Note:** The database now uses a simple JSON-based storage for development, which works on all platforms without requiring build tools or admin rights.

### 2. Configure Environment Variables

Create a `.env` file in the `auth-backend` folder:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database Configuration
# Options: 'sqlite' (for development) or 'postgres' (for production)
DB_TYPE=sqlite

# PostgreSQL Configuration (only needed if DB_TYPE=postgres)
# DATABASE_URL=postgresql://user:password@host:5432/database

# JWT Secret (generate a random string)
JWT_SECRET=your-super-secret-jwt-key-here

# Session Secret (generate a random string)
SESSION_SECRET=your-super-secret-session-key-here

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Frontend URL (for CORS and OAuth redirects)
FRONTEND_URL=http://localhost:5173

# Auth Backend URL (for OAuth callback - optional, defaults to http://localhost:PORT)
# AUTH_BACKEND_URL=http://localhost:3001

# Email Configuration (SMTP) - Optional, emails will be logged to console if not configured
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=your-email@gmail.com
# SMTP_PASSWORD=your-app-password
# SMTP_FROM=noreply@pictur.com
```

**Important:** Generate secure secrets for `JWT_SECRET` and `SESSION_SECRET`. You can use this command:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API** (or **People API** if Google+ is deprecated)
4. Go to "APIs & Services" > "Credentials"
5. Click "Create Credentials" > "OAuth client ID"
6. Select "Web application"
7. **Add Authorized redirect URI:**

   For local development, use one of these:

   - `http://localhost:3001/api/auth/google/callback` (recommended)
   - `http://127.0.0.1:3001/api/auth/google/callback` (alternative)

   **Important:**

   - Make sure there are **no trailing slashes**
   - Use `http://` (not `https://`) for localhost
   - The port (3001) must match your `PORT` in `.env`
   - If you get an error, try the shorter path: `http://localhost:3001/oauth/callback` and update the route accordingly

8. Copy the **Client ID** and **Client Secret** to your `.env` file

**Troubleshooting Redirect URI errors:**

- Make sure the URI exactly matches (no extra spaces, correct port)
- Try using `http://127.0.0.1:3001` instead of `http://localhost:3001`
- Ensure the OAuth consent screen is configured
- Wait a few minutes after creating credentials for them to propagate

### 4. Database Initialization

The database will be automatically created on first start in `auth-backend/data/auth.db` (for SQLite).

### 5. Create Initial Admin User

Before starting the server, create your first admin user:

```bash
npm run create-admin <email> <password> [name]
```

Example:

```bash
npm run create-admin admin@example.com securepassword123 "Admin User"
```

**Note:** If the user already exists, they will be promoted to admin. If they're already an admin, the script will inform you.

### 6. Start Server

```bash
npm run dev
```

The server will run on `http://localhost:3001`

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register new user (always creates as 'community' role)

  ```json
  {
    "email": "user@example.com",
    "password": "securepassword",
    "name": "User Name" // optional
  }
  ```

- `POST /api/auth/login` - Login with email/password

  ```json
  {
    "email": "user@example.com",
    "password": "securepassword"
  }
  ```

- `GET /api/auth/me` - Get current user (requires Bearer token in Authorization header)

- `POST /api/auth/logout` - Logout (requires Bearer token)

- `GET /api/auth/google` - Start Google OAuth flow

- `GET /api/auth/google/callback` - Google OAuth callback (handled automatically)

### Admin Endpoints (requires admin authentication)

- `POST /api/admin/promote-to-admin` - Promote a user to admin

  ```json
  {
    "email": "user@example.com"
  }
  ```

  **Headers:** `Authorization: Bearer <admin-token>`

- `GET /api/admin/users` - Get all users
  **Headers:** `Authorization: Bearer <admin-token>`

### Health Check

- `GET /api/health` - Server status

## Usage Examples

### Register a New User

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepassword123",
    "name": "John Doe"
  }'
```

### Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepassword123"
  }'
```

Response includes a `token` that should be used for authenticated requests.

### Get Current User

```bash
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer <your-token>"
```

### Promote User to Admin (as Admin)

```bash
curl -X POST http://localhost:3001/api/admin/promote-to-admin \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

### Get All Users (as Admin)

```bash
curl http://localhost:3001/api/admin/users \
  -H "Authorization: Bearer <admin-token>"
```

## User Roles

### Community (Default)

- All new users are automatically registered as 'community'
- Cannot be changed during registration
- Can upload turtle photos and view basic information
- Cannot access admin endpoints

### Admin/Researcher

- Can access all admin endpoints
- Can view all users
- Can promote other users to admin
- Must be created using `npm run create-admin` or promoted by another admin

## Database

### Development (JSON-based)

By default, the application uses a simple JSON-based database for local development. The database file is stored in `data/auth.json`.

**Pros:**

- No setup required
- Works on all platforms (Windows, Mac, Linux)
- No build tools or admin rights needed
- Perfect for local development
- Simple and fast for small datasets

**Cons:**

- Not suitable for production
- Limited to single process (no concurrent writes)
- No network access
- Slower than SQLite for large datasets

### Production (Hosted Database Required)

**Important:** For production, you **must** host your database on a server. SQLite is not suitable for production.

**Recommended Hosting Options:**

1. **Supabase** (Recommended - Free tier available)

   - Go to [supabase.com](https://supabase.com)
   - Create a free account and project
   - Get PostgreSQL connection string
   - Free tier: 500 MB database, 2 GB bandwidth

2. **Railway** - Easy PostgreSQL hosting at [railway.app](https://railway.app)

3. **Render** - Simple PostgreSQL hosting at [render.com](https://render.com)

4. **Self-hosted PostgreSQL** - Full control on AWS RDS, DigitalOcean, etc.

**Current Status:** The codebase currently uses a JSON-based database for development. PostgreSQL support needs to be implemented for production use.

**To use PostgreSQL:**

1. Install: `npm install pg @types/pg`
2. Update `src/db/database.ts` to support PostgreSQL
3. Update SQL syntax (AUTOINCREMENT → SERIAL, etc.)
4. Set `DATABASE_URL` in `.env` with your PostgreSQL connection string

## Database Schema

The `users` table contains:

- `id` - Unique ID (INTEGER PRIMARY KEY AUTOINCREMENT)
- `email` - Email address (TEXT UNIQUE NOT NULL)
- `password_hash` - Hashed password (TEXT, null for Google-only accounts)
- `name` - User name (TEXT, nullable)
- `google_id` - Google OAuth ID (TEXT UNIQUE, null for Email/Password accounts)
- `role` - Role: 'community' or 'admin' (TEXT NOT NULL DEFAULT 'community')
- `created_at` - Creation date (DATETIME DEFAULT CURRENT_TIMESTAMP)
- `updated_at` - Last update (DATETIME DEFAULT CURRENT_TIMESTAMP)

## Security

- **Password Hashing**: Passwords are hashed with bcrypt (10 rounds)
- **JWT Tokens**: Used for authentication (7-day expiration)
- **CORS**: Configured for the frontend URL only
- **Role-Based Access**: Admin endpoints require admin role
- **Input Validation**: Email and password validation on registration/login
- **SQL Injection Protection**: Using parameterized queries

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run create-admin` - Create initial admin user

## Troubleshooting

### Database not created

Make sure the `data/` directory exists and is writable. The database will be created automatically on first start.

### Google OAuth not working

1. **Redirect URI Error:**

   - Make sure the redirect URI in Google Cloud Console **exactly** matches: `http://localhost:3001/api/auth/google/callback`
   - No trailing slashes, correct port number
   - Try `http://127.0.0.1:3001/api/auth/google/callback` if localhost doesn't work
   - Wait a few minutes after creating credentials

2. **Check Environment Variables:**

   - Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set correctly in `.env`
   - No extra spaces or quotes around the values

3. **API Enabled:**

   - Make sure the **Google+ API** or **People API** is enabled in Google Cloud Console
   - Go to "APIs & Services" > "Library" and search for "Google+ API"

4. **OAuth Consent Screen:**
   - Make sure the OAuth consent screen is configured
   - Go to "APIs & Services" > "OAuth consent screen"
   - Add your email as a test user if in testing mode

### Email Configuration (SMTP)

To send real emails (for admin promotions and invitations), you need to configure SMTP settings in your `.env` file.

#### Option 1: Gmail

**Important:** App Passwords are only available for:

- Personal Google accounts (not Google Workspace/Enterprise accounts)
- Accounts with 2-Step Verification enabled
- Some accounts may not have App Passwords available due to account type or security settings

1. **Enable 2-Step Verification** on your Google Account:

   - Go to [Google Account Security](https://myaccount.google.com/security)
   - Enable "2-Step Verification"

2. **Create an App Password**:

   - Go to [App Passwords](https://myaccount.google.com/apppasswords)
   - If you don't see "App Passwords", it may not be available for your account type
   - Select "Mail" and "Other (Custom name)"
   - Enter "PicTur" as the name
   - Copy the generated 16-character password

3. **Add to `.env`**:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-16-character-app-password
   SMTP_FROM=your-email@gmail.com
   ```

**If App Passwords are not available:**

- **Option A:** Use a different email provider (see Options 2-3 below)
- **Option B:** Use Gmail OAuth2 (more complex, requires additional setup)
- **Option C:** Use a dedicated email service like SendGrid, Mailgun, or AWS SES (recommended for production)

#### Option 2: Outlook/Hotmail

1. **Enable App Passwords**:

   - Go to [Microsoft Account Security](https://account.microsoft.com/security)
   - Enable "Two-step verification"
   - Go to "App passwords" and create a new one

2. **Add to `.env`**:
   ```env
   SMTP_HOST=smtp-mail.outlook.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@outlook.com
   SMTP_PASSWORD=your-app-password
   SMTP_FROM=your-email@outlook.com
   ```

#### Option 3: Other SMTP Providers

For other providers (SendGrid, Mailgun, AWS SES, etc.), use their SMTP settings:

**SendGrid (Recommended - Free tier: 100 emails/day):**

1. **Sign up for free account:**

   - Go to [sendgrid.com](https://sendgrid.com) and create a free account
   - Verify your email address

2. **Create API Key:**

   - Go to Settings > API Keys
   - Click "Create API Key"
   - Name it "PicTur" and give it "Full Access" or "Mail Send" permissions
   - Copy the API key (you'll only see it once!)

3. **Add to `.env`**:

   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=apikey
   SMTP_PASSWORD=your-sendgrid-api-key-here
   SMTP_FROM=noreply@pictur.com
   ```

   **Note:** For `SMTP_FROM`, you can use any email address. SendGrid will send from this address (no verification needed for free tier in most cases).

**Mailgun:**

```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-mailgun-username
SMTP_PASSWORD=your-mailgun-password
SMTP_FROM=noreply@yourdomain.com
```

**AWS SES:**

```env
SMTP_HOST=email-smtp.region.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-aws-smtp-username
SMTP_PASSWORD=your-aws-smtp-password
SMTP_FROM=noreply@yourdomain.com
```

#### Troubleshooting Gmail App Passwords

**Problem: "App Passwords" option is not visible**

This can happen for several reasons:

1. **Google Workspace/Enterprise Account:**

   - App Passwords may be disabled by your organization's admin
   - Contact your IT administrator or use a personal Gmail account
   - Alternative: Use a dedicated email service (SendGrid, Mailgun, etc.)

2. **Account Type Restrictions:**

   - Some Google account types don't support App Passwords
   - Try using a different email provider

3. **2-Step Verification Not Fully Enabled:**

   - Make sure 2-Step Verification is fully set up and verified
   - Wait a few minutes after enabling before trying to create App Passwords

4. **Alternative Solutions:**
   - Use Outlook/Hotmail (see Option 2) - often easier to set up
   - Use a free email service like SendGrid (free tier: 100 emails/day)
   - Use Mailgun (free tier: 5,000 emails/month for 3 months)
   - Use AWS SES (very cheap, pay-as-you-go)

#### Development Mode (No SMTP)

If SMTP is not configured, emails will be logged to the console instead of being sent. This is useful for development and testing.

**Note:** Make sure to restart the server after adding SMTP configuration.

### Cannot create admin

- Make sure you run `npm run create-admin` before starting the server
- Check that the database file exists
- Verify the email doesn't already exist (or it will be promoted)

### CORS errors

- Check that `FRONTEND_URL` in `.env` matches your frontend URL
- Make sure the frontend is making requests to the correct backend URL

## Integration with Frontend

The frontend should:

1. Call `/api/auth/register` or `/api/auth/login` to authenticate
2. Store the returned `token` in localStorage
3. Include `Authorization: Bearer <token>` header in authenticated requests
4. Handle token expiration (redirect to login)

See the main `README.md` for frontend setup instructions.
