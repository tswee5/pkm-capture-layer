# Product Requirements Document
## Article Triage and Capture Layer

---

## Overview

Build a web application that ingests articles from TLDR AI newsletters, Twitter likes and bookmarks, and manual URL uploads. Users triage content into keep versus purge, optionally flag for deep dive versus surface-level processing, add personal notes and chat conversation summaries, and organize articles into topic buckets. All data flows to Supabase for later Obsidian sync.

---

## Core Features

### 1. Multi-Source Ingestion
- Gmail API integration for TLDR AI newsletters
- Twitter API v2 for user likes and bookmarks
- Manual URL upload with optional title and source metadata

### 2. Article Parsing
- Extract individual articles from TLDR emails: headline, link, and summary per article
- Twitter: extract tweet text, embedded links, and metadata
- Manual uploads: accept URL plus optional title; auto-fetch page title if not provided

### 3. Triage UI
- Card-based interface displaying articles from all sources
- Per-card actions:
  - **Keep** or **Purge**
  - **Depth flag**: Surface-level or Deep Dive
  - **Personal notes**: User's own summary and understanding
  - **Chat summary**: Paste-in summary from a Claude or ChatGPT conversation about this article
- Topic tagging via multi-select dropdown

### 4. Topic Buckets
- User can create named topic buckets (e.g., "Healthcare Policy", "AI Infrastructure")
- Multiple articles can be linked to a single topic, independent of source
- Topics are first-class objects, reusable across articles

### 5. Capture Storage
- Kept articles stored in Supabase with full metadata:
  - Source, link, headline, summary
  - Personal notes and chat summary (stored separately and distinctly)
  - Depth flag, topic associations, timestamp

---

## Design Direction

- **Style**: Minimal, focused, typography-forward
- **Palette**: Neutral base with a single accent color for interactive elements
- **References**: rauno.me for polish, paco.me for restraint
- **Dark mode**: Required
- **Interactions**: Subtle micro-interactions on triage actions; no unnecessary animation
- **Layout**: Left sidebar for topics + nav; main content area for article cards; clean top bar
- **Future**: PWA-ready (manifest + service worker can be added post-launch)

---

## Out of Scope for v1
- Obsidian sync (future)
- AI-powered cross-article analysis / connect-the-dots (future; structure data to support it)
- Morning Brew email parsing (future)
- PWA installation (add after core app is stable)

---

## Success Criteria
- TLDR AI newsletters parse correctly into individual article cards
- Twitter likes and bookmarks appear in triage feed
- Manual URL upload works end-to-end
- Triage decisions (keep/purge, depth flag, notes, topics) persist to Supabase
- UI is fast, clean, and pleasant to use daily
