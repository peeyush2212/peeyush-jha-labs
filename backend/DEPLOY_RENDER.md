# Deploy to Render (public URL)

This project can be deployed as a **single web service** (API + UI together).

## 1) Push to GitHub

From the folder that contains `backend/`, create a repo and push it to GitHub.

## 2) Create a Render Web Service

- New → Web Service
- Connect your GitHub repo
- Choose the branch

### Settings

- **Root Directory**: `backend`
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

### Environment variables

Optional (defaults to SQLite if unset):

- `DATABASE_URL` = `sqlite:///./app.db`

## 3) Deploy

Click “Create Web Service” → wait for deployment.

Render will provide a public `https://...onrender.com` URL.

## Notes

- On some free tiers, the filesystem is not guaranteed to persist across restarts. If you need persistent history, point `DATABASE_URL` to a managed Postgres database.
