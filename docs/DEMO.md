# Demo build

This repo ([stephen-m-g/aside-demo](https://github.com/stephen-m-g/aside-demo)) is the public, keyless version of aside: the full web UI with no backend. It's built to be deployed as a static site (Vercel) that anyone can click through, without exposing the Supabase project, the FastAPI server or any API keys.

The real app is the hackathon repo, [stephen-m-g/aside](https://github.com/stephen-m-g/aside), which this one is forked from. Nothing here talks to a server.

## What's different from the real app

Only five app files change; every other screen and component is the same code as the hackathon repo.

| File | Real app | Demo |
|---|---|---|
| `web/src/lib/supabase.ts` | Supabase client from env vars | In-browser stand-in (`src/demo/db.ts`), typed as the real client |
| `web/src/lib/api.ts` | `fetch` to the FastAPI server | Same functions, run in the browser (`src/demo/ai.ts`) |
| `web/src/hooks/useScribeTranscription.ts` | ElevenLabs Scribe (server-minted token) | Sample-lecture voice, or the browser's built-in speech recognition |
| `web/src/main.tsx` | Renders the app | Loads/seeds demo data first, adds the demo badge |
| `web/src/pages/Dashboard.tsx` | Logo in the header | Logo plus a slot for the Demo badge (`#demo-badge-slot`) |

Everything else that's demo-only lives in `web/src/demo/` and `web/public/demo/`.

- **`db.ts`**: the slice of supabase-js the app uses: filters, ordering, nested selects over foreign keys, insert/update/upsert/delete with `ON DELETE` rules, realtime `postgres_changes`, and the storage bucket. Data is kept in IndexedDB (survives reloads) and mirrored to other tabs over `BroadcastChannel`, so the student view at `/join` works in a second tab.
- **`ai.ts`**: the API endpoints (`describe`, `pages`, `refine`, `close`, `compile`), writing the same rows the server writes. Simple rules stand in for Gemini (`language.ts`: filler removal, a biology glossary for key terms and labels); pdf.js renders uploaded PDFs to page images locally.
- **`seed.ts`**: what a first-time visitor sees: three lectures, an archived one, three classes, and two recorded sessions with boards, ink, a smart annotation, transcripts and study notes. Bump `SEED_VERSION` when it changes so visitors get the new content.
- **`scripts.ts`** / **`voice.ts`**: the sample lectures and the voice picker.
- **`DemoBar.tsx`**: the Demo badge (next to the logo on the dashboard, floating elsewhere; hover or tap for Guide and Reset), the voice picker on the Teach screen, and the guide.
- **`web/public/demo/*.svg`**: original diagrams used by the seed.

Each visitor gets their own copy of the demo in their browser; nobody sees anyone else's changes. **Reset** (hover the Demo badge) restores the seed.

## Run it

```bash
npm --prefix web install
npm --prefix web run dev
```

No `.env.local` is needed (any that exists is ignored).

## Deploy (Vercel)

- **Root Directory:** `web`
- **Framework preset:** Vite (build `npm run build`, output `dist`)
- **Production branch:** `main`
- **Environment variables:** none. Remove any `VITE_SUPABASE_*` / `VITE_API_URL` from the project.

`web/vercel.json` already rewrites every path to `index.html` for client-side routing.

## Updating

Locally, this repo is the `demo` branch of the hackathon checkout, with this repo as the `demo-origin` remote. Pushing redeploys the site:

```bash
git switch demo
git push demo-origin demo:main
```

To bring in new work from the real app first:

```bash
git merge main
```

Conflicts can only happen in the files in the table above. Keep the demo version of the first four; in `Dashboard.tsx` take the real app's changes and keep the `demo-brand` wrapper and `#demo-badge-slot` around the logo. If the real app starts using a new Supabase feature (a new table, filter or column), add it to `src/demo/db.ts` (`TABLES`, `FKS`) and the seed.
