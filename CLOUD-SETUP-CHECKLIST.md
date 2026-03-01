# Cloud Setup Checklist

## Prerequisites
- [ ] GitHub account ready
- [ ] 15 minutes of free time

## Phase 1: Supabase Setup
- [ ] 1. Sign up at https://supabase.com/sign-up
- [ ] 2. Create project "job-tracker-prod"
- [ ] 3. Choose region (London/us-east-1)
- [ ] 4. Set strong database password (save it!)
- [ ] 5. Wait for project provisioning (~2 minutes)
- [ ] 6. Go to SQL Editor in Supabase
- [ ] 7. Create new query
- [ ] 8. Copy SQL schema from CLOUD-DEPLOYMENT.md
- [ ] 9. Run query (should see "Success")
- [ ] 10. Verify tables created: jobs, profiles, groups, etc.

**Completion Time:** ~10 minutes

---

## Phase 2: Collect API Keys
- [ ] 1. In Supabase, go to Settings → API
- [ ] 2. Copy Project URL: `https://xxxxx.supabase.co`
- [ ] 3. Copy SUPABASE_ANON_KEY (public key)
- [ ] 4. Save these securely (don't share the service role key!)

**Completion Time:** ~2 minutes

---

## Phase 3: Configure Local Environment
- [ ] 1. Create `.env` file in project root
- [ ] 2. Add lines:
  ```
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_ANON_KEY=your-key-here
  NODE_ENV=development
  ```
- [ ] 3. Verify `.gitignore` includes `.env`
- [ ] 4. Test locally: Open `index.html` in browser
- [ ] 5. Check browser console (should load without errors)

**Completion Time:** ~5 minutes

---

## Phase 4: Cloudflare Pages Deployment
- [ ] 1. Sign up at https://dash.cloudflare.com/sign-up
- [ ] 2. Go to Workers & Pages → Pages
- [ ] 3. Click "Create Application" → "Connect to Git"
- [ ] 4. Authorize GitHub
- [ ] 5. Select `job-tracker` repo
- [ ] 6. Build settings:
     - Build command: *(leave empty)*
     - Build output directory: `/`
     - Root directory: `/`
- [ ] 7. Add Environment Variables:
     ```
     SUPABASE_URL = https://your-project.supabase.co
     SUPABASE_ANON_KEY = your-anon-key
     NODE_ENV = production
     ```
- [ ] 8. Click "Save and Deploy"
- [ ] 9. Wait for deployment (~2 minutes)
- [ ] 10. App live at `https://job-tracker.pages.dev` ✨

**Completion Time:** ~10 minutes

---

## Phase 5: Testing
- [ ] 1. Open https://job-tracker.pages.dev in browser
- [ ] 2. Verify app loads (no console errors)
- [ ] 3. Test offline mode:
     - Open DevTools → Network
     - Set to "Offline"
     - Try adding a job
     - Go back online
     - Verify job synced
- [ ] 4. Check Supabase dashboard → jobs table
- [ ] 5. Verify new jobs appear in cloud

**Completion Time:** ~5 minutes

---

## Phase 6: GitHub & CI/CD Setup
- [ ] 1. Initialize git in project:
     ```bash
     cd "C:\Users\mark-\Documents\jt"
     git init
     ```
- [ ] 2. Create GitHub repo at github.com/new
- [ ] 3. Connect local repo:
     ```bash
     git remote add origin https://github.com/YOUR_USERNAME/job-tracker.git
     git branch -M main
     ```
- [ ] 4. Commit and push:
     ```bash
     git add .
     git commit -m "Initial commit with cloud integration"
     git push -u origin main
     ```
- [ ] 5. In GitHub repo → Settings → Secrets and variables → Actions
- [ ] 6. Create new repository secret:
     - Name: `CLOUDFLARE_API_TOKEN`
     - Value: Get from Cloudflare API Tokens page
- [ ] 7. Create second secret:
     - Name: `CLOUDFLARE_ACCOUNT_ID`
     - Value: From Cloudflare dashboard
- [ ] 8. Go back to Cloudflare Pages and reconnect repo (it should auto-select GitHub)
- [ ] 9. Test: Make a small change, push to GitHub
- [ ] 10. Verify auto-deployment in Cloudflare Pages dashboard

**Completion Time:** ~10 minutes

---

## Total Time: ~40 minutes

### 🎯 Final Result
- ✅ App running on Cloudflare Pages
- ✅ Data synced to Supabase PostgreSQL
- ✅ Offline-first sync working
- ✅ Auto-deployment on GitHub push
- ✅ Multi-device syncing ready

---

## After Setup: Integration Steps

Once everything is deployed, I'll:
1. Update `app.js` to initialize Supabase client on startup
2. Add authentication UI (sign up / sign in)
3. Implement real-time multi-device sync
4. Add team/group management
5. Create leaderboards

---

## 🆘 Need Help?

If anything goes wrong, check:
1. **Supabase not provisioning?** → Wait another minute, refresh page
2. **API key errors?** → Copy from Supabase again (check for spaces)
3. **Deployment fails?** → Check Cloudflare Pages build logs
4. **Sync not working?** → Check browser console for errors

**DM with:**
- Screenshot of error
- Which step failed
- What you see vs what you expected

---

**Ready? Start with Phase 1! Let me know when you've got your API keys.** 🚀
