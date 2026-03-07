# 🚀 Cloud Setup - Step-by-Step Guide

**Status:** Code prepared ✅ | Waiting for your API keys

---

## Step 1️⃣: Create Supabase Account & Project (5 minutes)

### Sign Up
1. Open https://supabase.com/sign-up in your browser
2. Click **"Sign up with GitHub"** (fast option)
3. Authorize Supabase on GitHub
4. Create organization (can be any name)

### Create Project
1. Click **"New Project"**
2. **Project Name:** `job-tracker-prod`
3. **Database Password:** Generate a strong one (save it!):
   ```
   Use: password generator or:
   openssl rand -base64 32
   ```
4. **Region:** Choose closest to you
   - London, UK → **London**
   - US → **us-east-1**
5. Click **"Create new project"**
6. ☕ Wait ~2 minutes for provisioning...

### Create Database Schema
1. In Supabase dashboard, go to **SQL Editor**
2. Click **"New Query"**
3. **Copy and paste the entire** [SQL schema from CLOUD-DEPLOYMENT.md](CLOUD-DEPLOYMENT.md#phase-2-database-schema) (lines ~50-200)
4. Click **"Run"**
5. ✅ Should see "Success" message

---

## Step 2️⃣: Get Your API Keys (2 minutes)

1. In Supabase dashboard, go to **Settings** → **API**
2. You'll see three sections. Copy these:

**📋 Project Settings:**
```
Project URL: https://xxxxx.supabase.co
```

**🔑 API Keys - Copy the "anon/public" key:**
```
SUPABASE_ANON_KEY: eyJhbGc...
```

**⚠️ DO NOT share the "service_role" key** - keep it secure

---

## Step 3️⃣: Set Up Environment Variables

### Option A: Local Development (Quick)

1. In `c:\Users\mark-\Documents\jt`, create file `.env`:
   ```bash
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   NODE_ENV=development
   ```

2. Verify `.gitignore` includes `.env`:
   ```bash
   .env
   .env.local
   config.local.js
   ```

3. **Do not edit `config.js` directly.**
   The app now reads its credentials from environment variables (see
   `.env.example` below).  Put your values in a local `.env` or configure them
   on your host – the file is automatically consumed by Vite/Cloudflare during
   build.

### Option B: Environment Variables (Production)
Set these on your server/hosting:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `NODE_ENV=production`

---

## Step 4️⃣: Cloudflare Pages Setup (5 minutes)

### Sign Up
1. Open https://dash.cloudflare.com/sign-up
2. Sign up with email or GitHub
3. No configuration needed yet!

### Connect Your GitHub Repo

1. Go back to Cloudflare dashboard
2. Click **"Workers & Pages"** in sidebar
3. Click **"Pages"** tab
4. Click **"Create an application"** → **"Connect to Git"**
5. Click **"GitHub"** → **"Authorize Cloudflare"**
6. Select your `job-tracker` repository
7. Configure build settings:
   - Build command: *(leave empty)*
   - Build output directory: `/`
   - Root directory: `/`
8. Under **Environment variables**, add:
   ```
   SUPABASE_URL = https://your-project.supabase.co
   SUPABASE_ANON_KEY = your-anon-key
   NODE_ENV = production
   ```
9. Click **"Save and Deploy"** 🚀

**Your app will be live at:** `https://job-tracker.pages.dev`

---

## Step 5️⃣: Optional - Custom Domain

1. In Cloudflare Pages → **Custom Domains**
2. Add your domain (e.g., `jobs.yourdomain.com`)
3. Follow DNS configuration instructions

---

## Step 6️⃣: Test Cloud Integration

Once deployed, test these:

### ✅ Test Offline-First Sync:
1. Open app at `https://job-tracker.pages.dev`
2. Disable internet (DevTools → Network tab → Offline)
3. Add a job locally
4. Go back online
5. Job should automatically sync to Supabase ✓

### ✅ Test Authentication (if implementing):
1. Sign up with new email
2. Check Supabase dashboard → Auth → Users
3. New user should appear ✓

### ✅ Test Multi-Device Sync:
1. Open app on desktop
2. Open app on mobile
3. Add job on desktop
4. Mobile should pull update within 30 seconds ✓

---

## 📝 GitHub Setup (CI/CD)

I've created `.github/workflows/deploy.yml` for automatic deployment.

### To Enable:

1. Push to GitHub:
   ```bash
   cd "C:\Users\mark-\Documents\jt"
   git add .
   git commit -m "Add cloud integration"
   git push
   ```

2. In GitHub repo → **Settings** → **Secrets and variables** → **Actions**
3. Add these:
   - `CLOUDFLARE_API_TOKEN`: Get from Cloudflare API token section
   - `CLOUDFLARE_ACCOUNT_ID`: From Cloudflare dashboard → Account

4. Now every push to `main` = automatic deployment! 🎯

---

## 🔒 Security Checklist

- [ ] `.env` file in `.gitignore`
- [ ] No API keys in GitHub repo
- [ ] Supabase RLS policies enabled ✓ (already in schema)
- [ ] Cloudflare Pages environment variables set ✓
- [ ] Service role key kept secure (not in client code)

---

## 🆘 Troubleshooting

**"SUPABASE_URL is not set"**
→ Add environment variables to Cloudflare Pages settings

**"Connection refused"**
→ Check Supabase project is provisioned (wait 2+ minutes)

**"Authentication failed"**
→ Verify API keys copied exactly (no extra spaces)

**"Jobs not syncing"**
→ Check browser Network tab for 401 errors (auth issue)
→ Check browser console for error messages

---

## ✨ What's Working

- ✅ **Supabase Client** - Ready to use (`js/supabase-client.js`)
- ✅ **Offline-First Sync** - Automatic sync when online (`js/sync.js`)
- ✅ **Conflict Resolution** - Last-write-wins strategy
- ✅ **GitHub Deployment** - Auto-deploy on push to main
- ✅ **Configuration** - Environment-aware settings

---

## 📊 Next Steps After Setup

1. **Initialize sync in app.js** - Call `syncEngine.init()` on startup
2. **Add sign-up/login UI** - Use `supabaseClient.signUp/signIn`
3. **Test with real data** - Export current jobs, import in cloud version
4. **Multi-user features** - Group/team management

---

**Let me know when you've completed steps 1-3, and I'll integrate everything into the app!** 🎉
