import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import axios from "axios";
import qs from "qs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
  SESSION_SECRET,
  PORT = 5173,
} = process.env;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.use(session({
  name: "sid",                // <— custom name
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  }
}));

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

const scopes = [
  "user-read-email",
  "user-read-private",
  "user-top-read",
  "user-read-recently-played",
].join(" ");

function requireAuth(req, res, next) {
  if (!req.session.access_token) return res.status(401).json({ error: "Not authorized" });
  next();
}

async function refreshToken(req) {
  if (!req.session.refresh_token) return;
  const payload = qs.stringify({
    grant_type: "refresh_token",
    refresh_token: req.session.refresh_token,
  });
  const authHeader = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const { data } = await axios.post(SPOTIFY_TOKEN_URL, payload, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${authHeader}`,
    },
  });
  req.session.access_token = data.access_token;
  if (data.refresh_token) req.session.refresh_token = data.refresh_token;
}

async function spotifyGet(req, url, params = {}) {
  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${req.session.access_token}` },
      params,
    });
    return data;
  } catch (err) {
    console.error(`[Spotify API Error] ${url}`, err.response?.status, err.response?.data);
    if (err.response && err.response.status === 401) {
      await refreshToken(req);
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${req.session.access_token}` },
        params,
      });
      return data;
    }
    throw err;
  }
}

// --- Auth routes ---
app.get("/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauth_state = state;

  const force = req.query.force === "true"; // check if ?force=true in URL

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: scopes,
    state,
  });

  if (force) {
    params.set("show_dialog", "true"); // force login/consent UI
  }

  const url = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  res.redirect(url);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  try {
    const payload = qs.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: SPOTIFY_CLIENT_ID,
      client_secret: SPOTIFY_CLIENT_SECRET,
    });
    const { data } = await axios.post(SPOTIFY_TOKEN_URL, payload, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    req.session.access_token = data.access_token;
    req.session.refresh_token = data.refresh_token;
    res.redirect("/");
  } catch (e) {
    res.status(500).send("Auth error");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sid");   // <— remove cookie in browser
    res.json({ ok: true });
  });
});


// --- Data helpers ---
function toMinutes(ms) {
  return Math.round((ms / 60000) * 10) / 10; // 1 decimal
}

function startOfNDaysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

// Try to page recently played back up to 7 days
async function fetchRecentWeek(req) {
  const weekStartMs = startOfNDaysAgo(7);
  let items = [];
  let before = Date.now(); // page backwards
  const limit = 50;
  for (let i = 0; i < 20; i++) { // hard cap ~1000 plays if API allows
    const data = await spotifyGet(req, `${API_BASE}/me/player/recently-played`, {
      limit,
      before,
    });
    if (!data.items?.length) break;
    items = items.concat(data.items);
    const oldest = data.items[data.items.length - 1];
    before = new Date(oldest.played_at).getTime();
    if (before < weekStartMs) break; // we paged into the week
  }
  // Filter to last 7 days
  return items.filter((it) => new Date(it.played_at).getTime() >= weekStartMs);
}

function aggregateListening(recent) {
  // Each item includes track object with duration_ms; 1 play ≈ full track duration
  const perTrack = new Map();
  const perArtist = new Map();
  let totalMs = 0;

  for (const it of recent) {
    const t = it.track;
    if (!t) continue;
    const trackKey = `${t.id}::${t.name}`;
    const trackMs = t.duration_ms || 0;
    totalMs += trackMs;

    // Track agg
    const tPrev = perTrack.get(trackKey) || { name: t.name, artists: t.artists.map(a => a.name), plays: 0, ms: 0 };
    tPrev.plays += 1;
    tPrev.ms += trackMs;
    perTrack.set(trackKey, tPrev);

    // Artist agg
    for (const a of t.artists || []) {
      const aPrev = perArtist.get(a.name) || { name: a.name, plays: 0, ms: 0 };
      aPrev.plays += 1;
      aPrev.ms += trackMs;
      perArtist.set(a.name, aPrev);
    }
  }

  const tracks = [...perTrack.values()].sort((a, b) => b.ms - a.ms);
  const artists = [...perArtist.values()].sort((a, b) => b.ms - a.ms);

  return {
    totalMinutes: toMinutes(totalMs),
    tracks: tracks.map(t => ({ ...t, minutes: toMinutes(t.ms) })),
    artists: artists.map(a => ({ ...a, minutes: toMinutes(a.ms) })),
  };
}

// --- API route to assemble the "Wrapped" ---
app.get("/api/wrapped", requireAuth, async (req, res) => {
  try {
    const [me, topArtists, topTracks, recent] = await Promise.all([
      spotifyGet(req, `${API_BASE}/me`),
      spotifyGet(req, `${API_BASE}/me/top/artists`, { time_range: "short_term", limit: 10 }),
      spotifyGet(req, `${API_BASE}/me/top/tracks`, { time_range: "short_term", limit: 10 }),
      fetchRecentWeek(req),
    ]);

    const agg = aggregateListening(recent);

    // Top genre (from top artists genres list)
    const genreCounts = {};
    for (const a of topArtists.items || []) {
      for (const g of a.genres || []) {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      }
    }
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

    res.json({
      user: { id: me.id, name: me.display_name, image: me.images?.[0]?.url || null },
      topArtists: (topArtists.items || []).slice(0, 3).map(a => ({
        name: a.name,
        genres: a.genres,
        image: a.images?.[0]?.url || null,
        url: a.external_urls?.spotify,
      })),
      topTracks: (topTracks.items || []).slice(0, 5).map(t => ({
        name: t.name,
        artists: t.artists.map(a => a.name),
        image: t.album?.images?.[0]?.url || null,
        url: t.external_urls?.spotify,
      })),
      listening: {
        window: "Last 7 days (API-limited estimate)",
        totalMinutes: agg.totalMinutes,
        perArtist: agg.artists.slice(0, 5),
        perTrack: agg.tracks.slice(0, 5),
      },
      topGenre,
      notes: "Spotify API limits recently played history; totals are a best-effort for the past week.",
    });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "Failed to build wrapped" });
  }
});

// Fallback to index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
