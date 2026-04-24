# Deploy Spice Auction to Railway

## Quick Setup (10 minutes)

### Step 1: Push code to GitHub

Create a new GitHub repo and push your project:

```bash
cd spice-auction/backend
git init
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/spice-auction.git
git branch -M main
git push -u origin main
```

Your repo should have this structure:
```
├── server.js
├── db.js
├── export.js
├── import-source.js  (if exists)
├── package.json       ← use the one provided
├── Dockerfile         ← use the one provided
├── .dockerignore      ← use the one provided
├── public/
│   ├── index.html
│   └── app.html
└── data/              ← will be created automatically
```

### Step 2: Create Railway project

1. Go to https://railway.app and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. Select your `spice-auction` repo
4. Railway auto-detects the Dockerfile and starts building

### Step 3: Add persistent storage (IMPORTANT!)

Without this, your database resets on every deploy:

1. In your Railway project, click the service
2. Go to **Settings** → **Volumes**
3. Click **"Add Volume"**
4. Mount path: `/app/data`
5. Click **"Add"**

This mounts a persistent disk at `/app/data` where your SQLite database lives.

### Step 4: Get your URL

1. Go to **Settings** → **Networking**
2. Click **"Generate Domain"**
3. You'll get a URL like: `spice-auction-production.up.railway.app`

### Step 5: Share with testers

- **Admin:** `https://YOUR-URL.up.railway.app`
- **User app:** `https://YOUR-URL.up.railway.app/app`
- **Default login:** admin / admin123

---

## Important Notes

- **Change the admin password** immediately after first login
- Railway free trial gives you $5 credit (enough for ~2-3 weeks of testing)
- The SQLite database persists across deploys thanks to the volume
- Auto-backup still runs every 6 hours inside the container
- To download a backup, use Admin → Tools → Backup

## Re-deploying after code changes

Just push to GitHub — Railway auto-deploys:

```bash
git add -A
git commit -m "Fix: description of change"
git push
```

## Troubleshooting

**App won't start:** Check Railway logs (click service → "Logs" tab)

**Database reset:** You forgot to add the volume. Add it in Settings → Volumes, mount at `/app/data`

**Can't connect:** Make sure you generated a domain in Settings → Networking
