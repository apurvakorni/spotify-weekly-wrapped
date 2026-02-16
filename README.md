# Weekly Wrapped🎧

A Spotify-inspired “Weekly Wrapped” web app that generates personalized listening insights (top artists, top tracks, genres, minutes listened) from your recent listening history.

## ✨ Features
- OAuth 2.0 login with Spotify (Authorization Code flow)
- Automatic refresh token handling (stays signed in smoothly)
- Weekly insights dashboard:
  - Top Tracks / Top Artists
  - Top Genres (based on artist genres)
  - Listening time summary (based on track durations)
- Pagination handling for Spotify API endpoints
- Clean separation between backend (Express) and frontend (static UI)

## 🧰 Tech Stack
- Backend: Node.js, Express
- API: Spotify Web API
- Auth: OAuth 2.0 (Authorization Code + Refresh Token)
- Frontend: HTML/CSS/JS (or your framework if applicable)

## 🚀 Getting Started

### 1) Prerequisites
- Node.js 18+ recommended
- A Spotify Developer account + app credentials

### 2) Create a Spotify App
1. Go to the Spotify Developer Dashboard
2. Create an app and note your **Client ID** and **Client Secret**
3. Add a Redirect URI:
   - Example: `http://localhost:3000/callback` (match what your server expects)

### 3) Configure Environment Variables
Create a `.env` file in the project root:

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
SESSION_SECRET=some_long_random_secret
PORT=3000
```
### 4) Install & Run
```
npm install
npm run dev
```
