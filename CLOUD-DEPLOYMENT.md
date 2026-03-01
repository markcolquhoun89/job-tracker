# Job Tracker - Cloud Deployment Guide

## Phase 1: Supabase Setup

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Choose organization and project name: **job-tracker-prod**
4. Set database password (save this securely!)
5. Choose region closest to you (e.g., London for UK)
6. Wait for project provisioning (~2 minutes)

### 2. Database Schema

Run this SQL in Supabase SQL Editor to create tables:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('engineer', 'manager', 'admin')),
  group_id UUID REFERENCES public.groups(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Groups/Teams table
CREATE TABLE public.groups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job types table
CREATE TABLE public.job_types (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  pay NUMERIC(10,2) NOT NULL,
  int NUMERIC(10,2),
  group_id UUID REFERENCES public.groups(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs table
CREATE TABLE public.jobs (
  id TEXT PRIMARY KEY, -- Keep original ID for offline compatibility
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  group_id UUID REFERENCES public.groups(id),
  job_type TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Completed', 'Internals', 'Failed')),
  fee NUMERIC(10,2) DEFAULT 0,
  base_fee NUMERIC(10,2),
  manual_fee BOOLEAN DEFAULT FALSE,
  job_id_external TEXT, -- User's custom job ID
  notes TEXT,
  is_upgraded BOOLEAN DEFAULT FALSE,
  
  -- Saturday premium tracking
  saturday_premium BOOLEAN DEFAULT FALSE,
  
  -- ELF flag
  elf BOOLEAN DEFAULT FALSE,
  elf_added_by UUID REFERENCES auth.users(id),
  elf_added_date TIMESTAMPTZ,
  
  -- Candid flag
  candids BOOLEAN DEFAULT FALSE,
  candids_reason TEXT,
  candids_added_by UUID REFERENCES auth.users(id),
  candids_added_date TIMESTAMPTZ,
  
  -- Chargeback
  chargeback BOOLEAN DEFAULT FALSE,
  chargeback_reason TEXT,
  chargeback_amount NUMERIC(10,2),
  chargeback_week DATE,
  chargeback_added_by UUID REFERENCES auth.users(id),
  chargeback_added_date TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Sync tracking
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  local_updated_at TIMESTAMPTZ
);

-- Expenses table
CREATE TABLE public.expenses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  date DATE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications table
CREATE TABLE public.notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_jobs_user_id ON public.jobs(user_id);
CREATE INDEX idx_jobs_group_id ON public.jobs(group_id);
CREATE INDEX idx_jobs_date ON public.jobs(date);
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_jobs_elf ON public.jobs(elf) WHERE elf = TRUE;
CREATE INDEX idx_jobs_candids ON public.jobs(candids) WHERE candids = TRUE;
CREATE INDEX idx_jobs_chargeback ON public.jobs(chargeback) WHERE chargeback = TRUE;
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read);

-- Row Level Security (RLS)

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read all, update own
CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Groups: All can read, managers/admins can create/update
CREATE POLICY "Users can view groups"
  ON public.groups FOR SELECT
  USING (true);

CREATE POLICY "Managers can create groups"
  ON public.groups FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- Job types: All can read, managers/admins can modify
CREATE POLICY "Users can view job types"
  ON public.job_types FOR SELECT
  USING (true);

CREATE POLICY "Managers can manage job types"
  ON public.job_types FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- Jobs: Users can CRUD own jobs; Managers can view group jobs; Admins can view all
CREATE POLICY "Users can view own jobs"
  ON public.jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Managers can view group jobs"
  ON public.jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() 
        AND p.role IN ('manager', 'admin')
        AND (p.role = 'admin' OR p.group_id = jobs.group_id)
    )
  );

CREATE POLICY "Users can insert own jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own jobs"
  ON public.jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Managers can flag jobs"
  ON public.jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() 
        AND p.role IN ('manager', 'admin')
        AND (p.role = 'admin' OR p.group_id = jobs.group_id)
    )
  );

CREATE POLICY "Users can delete own jobs"
  ON public.jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Expenses: Users can CRUD own
CREATE POLICY "Users can manage own expenses"
  ON public.expenses FOR ALL
  USING (auth.uid() = user_id);

-- Notifications: Users can view/update own
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Functions

-- Update timestamp on modification
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'User'),
    'engineer'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

### 3. Get API Keys

1. Go to **Settings** → **API** in Supabase dashboard
2. Copy these values (save securely):
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon/public key**: `eyJhbGc...` (for client-side)
   - **service_role key**: `eyJhbGc...` (for server-side only, keep secret!)

---

## Phase 2: Cloudflare Pages Deployment

### 1. Prepare Repository

```bash
# Initialize git if not already done
cd "C:\Users\mark-\Documents\jt"
git init
git add .
git commit -m "Initial commit - Job Tracker with cloud ready"

# Push to GitHub (create repo first at github.com)
git remote add origin https://github.com/YOUR_USERNAME/job-tracker.git
git branch -M main
git push -u origin main
```

### 2. Create `wrangler.toml`

```toml
name = "job-tracker"
compatibility_date = "2024-01-01"
pages_build_output_dir = "."

[env.production]
vars = { ENVIRONMENT = "production" }
```

### 3. Create Environment Config File

Create `config.js` in root:

```javascript
// Environment configuration
const CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_ANON_KEY',
  APP_VERSION: '2.0.0',
  SYNC_ENABLED: true,
  OFFLINE_FIRST: true
};

// Don't expose in production
if (typeof window !== 'undefined') {
  window.APP_CONFIG = CONFIG;
}
```

### 4. Deploy to Cloudflare Pages

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Workers & Pages** → **Create Application** → **Pages** → **Connect to Git**
3. Authorize GitHub and select your repository
4. Configure build:
   - **Build command**: (leave empty - static site)
   - **Build output directory**: `/`
   - **Root directory**: `/`
5. Add environment variables:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_ANON_KEY`: Your public anon key
6. Click **Save and Deploy**

Your app will be live at: `https://job-tracker.pages.dev`

### 5. Custom Domain (Optional)

1. In Cloudflare Pages → **Custom Domains**
2. Add your domain (e.g., `jobs.yourdomain.com`)
3. Update DNS records as instructed

---

## Phase 3: Offline-First Sync Architecture

### Sync Strategy

**Offline-First Approach:**
- All data writes go to IndexedDB first (instant)
- Background sync pushes changes to Supabase when online
- Conflicts resolved with "last write wins" + timestamp

### Sync Flow

```
User Action → IndexedDB (instant) → Mark as "pending sync" → Background job → Supabase → Mark as "synced"
                ↓
           UI updates immediately
```

### Implementation Files to Create

**`js/sync.js`** - Sync engine
**`js/supabase-client.js`** - Supabase wrapper
**`js/conflict-resolver.js`** - Handle sync conflicts

---

## Phase 4: Authentication Integration

### Supabase Auth Features

- Email/password signup
- Magic link (passwordless)
- OAuth (Google, GitHub, etc.)
- Session management
- JWT tokens

### Auth Flow

1. User signs up/logs in via Supabase Auth
2. Profile created automatically (trigger)
3. JWT stored in localStorage
4. All API calls include JWT in headers
5. RLS policies enforce permissions

---

## Next Steps

1. ✅ Create Supabase project
2. ✅ Run SQL schema
3. ✅ Get API keys
4. ⏳ Build sync layer (`js/sync.js`)
5. ⏳ Integrate Supabase client
6. ⏳ Add authentication UI
7. ⏳ Deploy to Cloudflare Pages
8. ⏳ Test multi-device sync

---

## Environment Variables

Store these securely (never commit to git):

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_KEY=eyJhbGc... (server-side only)
```

Add `.env` to `.gitignore`:
```
.env
.env.local
config.local.js
```

---

**Ready to start?** Let me know when you've created the Supabase project and I'll help build the sync layer!
