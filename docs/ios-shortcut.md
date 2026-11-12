# iOS Shortcut: "Save to Capture"

A build recipe for the Shortcuts app on your iPhone. Takes about 10 minutes.
It posts to `POST /api/capture` (see `app/api/capture/route.ts`), the
token-authenticated endpoint built for this — no sign-in, no cookie.

You'll need the `CAPTURE_API_TOKEN` value. Claude will give it to you once,
in the final message of the session that built this. Paste it straight into
the Shortcut action in step 5 below and nowhere else — don't save it in
Notes, Messages, or anywhere that syncs or gets shared.

## Build it

Open the **Shortcuts** app → **+** → name it **Save to Capture**.

### 1. Shortcut details

Tap the (i) info button → turn on **Show in Share Sheet**. Under
**Share Sheet Types**, make sure these are checked: **Safari web pages**,
**URLs**, and **Text**. (Also enable **Use with Share Sheet** if the app
shows it as a separate toggle from "Show in Share Sheet" on your iOS
version.)

### 2. Branch on the input type

Add an **If** action: **If** `Shortcut Input` **has any value** (the
default "Input" condition is fine — what matters is the two branches
below).

Actually, simplest reliable branch: add an **If** action testing
**"Shortcut Input" → "Is Type" → "Safari web page"**.

**If it's a Safari web page:**

Add **Run JavaScript on Web Page**, and paste in exactly this script:

```javascript
var result = {
  url: location.href,
  title: document.title,
  selection: String(window.getSelection()).trim(),
};
completion(JSON.stringify(result));
```

Shortcuts requires the `completion(...)` call — the action hangs forever
without it.

Then add **Get Dictionary from Input**, feeding it the JavaScript action's
result (Shortcuts should wire this automatically since it's the most recent
output — the "Dictionary" contains `url`, `title`, `selection` as fields you
can reference later via "Get Dictionary Value" or by tapping into the magic
variable).

**Otherwise** (URL or plain text shared from another app):

Just pass **Shortcut Input** through as-is — this becomes your `text` value
below. No extra action needed; reference the raw "Shortcut Input" variable
directly where `text` is used in step 5.

### 3. (covered by the If/Otherwise branches above — nothing further here)

### 4. Ask for a note

Add **Ask for Input**:
- Input Type: **Text**
- Allow Multiline Input: **on**
- Prompt: `Note (optional)`

Leave **Default Answer** blank. Pressing **Done** with nothing typed must
produce an empty string, not cancel the Shortcut — Shortcuts does this by
default as long as you don't check "Required input" (there isn't one here,
so you're fine either way, but don't add any validation step that blocks on
an empty note).

### 5. Send it

Add **Get Contents of URL**:
- URL: `https://pkm-capture-layer.vercel.app/api/capture`
- Method: **POST**
- Headers:
  - `Authorization`: `Bearer <your CAPTURE_API_TOKEN>`
  - `Content-Type`: `application/json`
- Request Body: **JSON**, with these fields:
  - `url` → the Safari-branch dictionary's `url` field (leave blank/omit on
    the text branch — Shortcuts lets a JSON field reference nothing)
  - `text` → the raw **Shortcut Input** (the text/URL branch's value;
    leave blank on the Safari branch)
  - `quote` → the Safari-branch dictionary's `selection` field
  - `note` → the output of the **Ask for Input** action from step 4

(If your Shortcuts version makes it awkward to leave a JSON field truly
empty per branch, it's fine to send an empty string for the field that
doesn't apply on that branch — the route treats empty strings as absent.)

### 6. Show the result

Add **Get Dictionary from Input**, feeding it the **Get Contents of URL**
result, then **Show Notification**:
- Title: the dictionary's `title` field (falls back to showing the error
  text if the request failed — e.g. via a **Get Dictionary Value → error**
  lookup, shown instead when `error` is present)
- Body: something like "Saved" or "Merged into existing item" — your call;
  the important thing on screen is that it fired.

## Tested flows

Try each of these once after building the Shortcut, matching the
acceptance tests in the spec (§7, items 9–12):

1. **Share a Safari page via the toolbar Share button**, no selection, no
   note. Expect a "Saved: <title>" notification and a new item in the
   dashboard.
2. **Highlight a passage in Safari, then use the toolbar Share button**
   (not the text-selection popup menu) while the selection is active.
   Expect the quote to show up on the item.
3. **Share the same page again** with a note typed in. Expect the
   notification to say it merged, and the note to appear on the existing
   item (not a duplicate).
4. **Share a plain URL from another app** (e.g. paste a link into Messages
   to yourself, then share it from there, or share from an RSS reader).
   Expect it to save normally via the `text` branch.
5. **Share plain text with no URL in it at all** (e.g. select some words in
   Notes and share just that). Expect the notification to show the
   "No link found" guidance message, not a silent failure.

## Troubleshooting

- **The quote never shows up, even though I know I highlighted text.** The
  text-selection popup menu's **Share…** button sends *only the selected
  text*, not the page URL — so the Shortcut has no link to attach the quote
  to. Instead, with the selection still active, use Safari's **toolbar**
  Share button (the square-with-arrow icon in the address bar area), which
  shares the live page along with the selection. If that's not available on
  your setup, use **Copy Link with Highlight** from the selection menu
  instead, then share *that* copied link through the Shortcut — it encodes
  the highlight as a `#:~:text=` fragment, which `/api/capture` decodes
  into a quote automatically.
