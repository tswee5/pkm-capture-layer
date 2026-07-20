# Technical Specification
## Article Triage and Capture Layer

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router) + React |
| Styling | Tailwind CSS |
| Backend | Next.js API routes |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth with Google OAuth |
| Gmail | Gmail API v1 via Google OAuth token |
| Twitter | Twitter API v2 (OAuth 2.0 PKCE) |
| Deployment | Local dev tonight; Vercel or Railway later |

---

## Database Schema

### `articles`
```sql
CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  source TEXT CHECK (source IN ('tldr', 'twitter', 'manual')) NOT NULL,
  link TEXT,
  headline TEXT NOT NULL,
  summary TEXT,
  personal_notes TEXT,
  chat_summary TEXT,
  depth_flag TEXT CHECK (depth_flag IN ('surface', 'deep')),
  status TEXT CHECK (status IN ('pending', 'keep', 'purge')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_articles_user_status ON articles (user_id, status, created_at DESC);
```

### `topics`
```sql
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_topics_user ON topics (user_id);
```

### `article_topics` (junction table)
```sql
CREATE TABLE article_topics (
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (article_id, topic_id)
);
```

---

## API Endpoints

### Articles

**`GET /api/articles`**
- Query params: `status` (pending | keep | purge), `topic_id`
- Returns: array of articles with associated topics

**`POST /api/articles/triage`**
- Body: `{ article_id, status, depth_flag?, personal_notes?, chat_summary? }`
- Updates article record, sets `updated_at`
- Returns: updated article object

**`POST /api/articles/upload`**
- Body: `{ url, title?, source_label? }`
- Auto-fetches page title via meta tags if title not provided
- Inserts into articles with source='manual', status='pending'
- Returns: new article object

### Topics

**`GET /api/topics`**
- Returns: all topics for authenticated user with article counts

**`POST /api/topics`**
- Body: `{ name, description? }`
- Returns: new topic object

**`POST /api/articles/link-topic`**
- Body: `{ article_id, topic_id }`
- Inserts into article_topics junction table
- Returns: success confirmation

### Sync

**`POST /api/sync/gmail`**
- Triggers Gmail OAuth flow if not already authorized
- Fetches TLDR AI emails (filter by sender: `@tldr.tech`)
- Parses each email into individual articles (see parsing logic below)
- Inserts new articles into Supabase (skip duplicates by link)
- Returns: `{ inserted: number, skipped: number }`

**`POST /api/sync/twitter`**
- Triggers Twitter OAuth 2.0 PKCE flow if not already authorized
- Fetches liked tweets and bookmarked tweets for authenticated user
- Extracts article metadata (see parsing logic below)
- Inserts new articles into Supabase (skip duplicates by link or tweet ID)
- Returns: `{ inserted: number, skipped: number }`

---

## Parsing Logic

### TLDR AI Email Parsing

TLDR emails follow a consistent format:
- Each article block contains a bold headline, a URL, and a 1–2 sentence summary
- Articles are separated by clear section breaks

Parsing steps:
1. Fetch raw email body (prefer HTML, fallback to plain text)
2. Strip HTML tags, normalize whitespace
3. Use regex to identify article blocks: look for lines with all-caps or title-case headline followed by a URL pattern, then summary text
4. Extract per-article: `{ headline, link, summary }`
5. Skip sponsor/advertisement blocks (heuristic: contains "sponsor" or "advertisement" in surrounding text)
6. Output: array of article objects

Suggested regex pattern for link extraction:
```
/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g
```

### Twitter Parsing

Using Twitter API v2 endpoints:
- `GET /2/users/:id/liked_tweets` — user likes
- `GET /2/users/:id/bookmarks` — user bookmarks

Request fields: `id,text,created_at,author_id,entities,attachments`

Per tweet:
- If tweet contains URL entities: extract first non-Twitter URL as `link`, use tweet text as `summary`, use URL title as `headline` (fetch via Open Graph if needed)
- If no external URL: use tweet text as both `headline` and `summary`, set `link` to tweet permalink
- Store `source = 'twitter'`

---

## UI Layout

### Left Sidebar
- App name / logo
- Topic list with article counts (click to filter main feed)
- "New Topic" button
- Sync buttons: "Sync TLDR", "Sync Twitter"
- Sync status indicator (last synced timestamp)
- User profile / logout at bottom

### Main Content Area
- Filter tabs: All | Pending | Kept | Purged
- Article cards in a scrollable feed
- Each card contains:
  - Source badge (TLDR / Twitter / Manual) with icon
  - Headline (linked)
  - Summary text
  - Depth flag toggle: Surface / Deep Dive
  - Triage buttons: Keep / Purge
  - Expandable section for: Personal Notes textarea, Chat Summary textarea
  - Topic tag selector (multi-select)

### Top Bar
- Search (future)
- Dark/light mode toggle
- Sync status

---

## Design Tokens

```css
/* Neutral palette with blue accent */
--color-bg: #0f0f0f;              /* near-black background */
--color-surface: #1a1a1a;         /* card background */
--color-border: #2a2a2a;          /* subtle borders */
--color-text-primary: #f0f0f0;    /* primary text */
--color-text-secondary: #888888;  /* metadata, timestamps */
--color-accent: #3b82f6;          /* blue accent for interactive elements */
--color-accent-hover: #2563eb;
--color-keep: #22c55e;            /* green for keep action */
--color-purge: #ef4444;           /* red for purge action */
--color-deep: #a855f7;            /* purple for deep dive flag */
--color-surface: #1a1a1a;

/* Typography */
--font-display: 'Inter', sans-serif;
--font-body: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;  /* for links/URLs */
```

---

## Authentication Flow

1. User visits app, redirected to Supabase Google OAuth login
2. After login, Supabase session established
3. Gmail sync: request additional Gmail read scope (`https://www.googleapis.com/auth/gmail.readonly`) via Google OAuth
4. Twitter sync: separate Twitter OAuth 2.0 PKCE flow; store access token in Supabase user metadata or a separate `user_integrations` table
5. All API routes protected via Supabase session middleware

---

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
TWITTER_BEARER_TOKEN=

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Project Structure

```
/app
  /api
    /articles
      route.ts          # GET articles
      /triage/route.ts  # POST triage decision
      /upload/route.ts  # POST manual upload
      /link-topic/route.ts
    /topics/route.ts
    /sync
      /gmail/route.ts
      /twitter/route.ts
  /dashboard
    page.tsx            # main triage UI
  layout.tsx
  page.tsx              # auth redirect

/components
  ArticleCard.tsx
  TopicSidebar.tsx
  TriageButtons.tsx
  NotesDrawer.tsx
  SyncStatus.tsx

/lib
  supabase.ts
  gmail.ts
  twitter.ts
  parseTLDR.ts

/types
  index.ts
```

---

## Out of Scope for v1
- Obsidian sync script (build after UI is stable)
- AI-powered cross-article analysis
- Morning Brew parsing
- PWA manifest / service worker
- Full-text search

---

## Data Future-Proofing Notes

Schema is designed to support future features:
- `personal_notes` and `chat_summary` stored as separate columns so AI can later query and differentiate user understanding vs. AI synthesis
- Topic many-to-many relationship supports graph-style querying across sources and depths
- `depth_flag` enables Obsidian sync script to route to correct note template (lightweight vs. deep dive)
- `source` enum is extensible (add 'morning_brew', 'rss', etc. later)
