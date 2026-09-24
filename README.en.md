# DPDAI Blog Automation

[Türkçe](README.md) · **English**

A multi-site, multilingual, SEO-friendly blog production and publishing panel.
You enter the topics; the system writes the article on a schedule, self-reviews and
corrects it, generates and quality-checks the image, translates it, and pushes it to
WordPress. You approve from the panel.

## What it does

| Step | Description |
|---|---|
| Calendar | Per site: "how many posts a week, which days, what time." Quota is distributed automatically. |
| Plan | Derives search intent, focus keyword, H2/H3 outline and an FAQ list from the topic. |
| Text | HTML body from the plan. Standards are embedded in the prompt; cliché patterns are banned. |
| SEO | Meta title/description, slug, OG tags, category/tags, internal-link suggestions, JSON-LD (BlogPosting + FAQPage; FAQ answers read from the body). |
| **Review** | 20+ measured checks: length, section structure, thin sections, duplicate headings, keyword density and placement, readability (Ateşman/Flesch), paragraph/sentence length, cliché scan, lists/tables/FAQ, alt text. Weighted 0–100 score across 5 areas. |
| **Autonomous fixing** | An AI editor critique is merged with mechanical findings and a targeted revision round runs. It extends thin text, deepens shallow sections, balances density, rewrites meta fields. If the score drops, the old text is kept. |
| **Image** | Structured prompt (subject / setting / mood / framing + brand style + technical quality + negatives), WebP conversion, technical checks (size, ratio, file size) and AI visual review (text, watermark, subject relevance, anatomy). On failure it appends the error to the prompt and retries. |
| **Branded cover** | The generated/stock photo is composed into a consistent branded cover: brand-colored panel + photo + the blog **title overlaid**. Always on-topic and consistent across posts. |
| **Internal linking** | After production, real `<a>` links to already-published posts on the same site are inserted into the body. The model picks the anchor; code does the placement (no fabricated links). |
| **Conflict (cannibalization) check** | When adding topics, compares against the topic pool, produced articles and pages already live on the site; warns about cannibalization risk. |
| **Budget cap** | Monthly spend limit; when reached it stops new production but never blocks publishing of approved posts. |
| **Notifications** | Production errors, budget thresholds and site-connection failures are sent via Telegram or webhook (Slack/Discord). |
| Translation | Not literal translation but market adaptation (transcreation). HTML structure is preserved and validated; a separate focus keyword is chosen in the target language. Sector-aware technical terminology. |
| **Site-wide translation audit** | Scans all content (posts, pages, products) via Polylang, reports missing and broken/partial translations, and completes them — fetch source → sector-aware translation → target-language SEO → publish linked to the original. |
| **Menu translation** | Copies the navigation menu to each language, translates labels, links items to the translated pages, adds a language switcher. |
| Publishing | WordPress REST + `dpdai-bridge`. Idempotent (no duplicate posts). Posts below the score threshold are not auto-published. |
| **Statistics** | Production/publishing flow, quality distribution, per-site comparison, cost and time per step, error rates, publishing-density heatmap. |
| **Site SEO audit** | Scans the whole site: indexing, technical, meta, content, structured data. Produces a prioritized action plan. |
| **Automatic backup** | Daily `pg_dump` of Postgres to the storage volume, with pruning of old backups and failure notification. |

## API pool and failover

Multiple providers are defined per job and tried in order. If one fails, it automatically
moves to the next; if all fail, production stops and a notification is sent. Managed from
**Settings → Text / Image providers**.

### Failure classification and back-off

| Failure | State | Wait |
|---|---|---|
| Invalid key (401/403) | `BROKEN` | 12h |
| Quota/credit exhausted (402) | `BROKEN` | 6h |
| Rate limit (429) | `COOLDOWN` | 5 min |
| Server error (5xx) | `COOLDOWN` | 3 min |
| Connection/timeout | `COOLDOWN` | 2 min |
| Bad request (400) | — | no wait, moves to next |

Repeated failures back off progressively (up to 12h). Health is stored in the database, so a
broken key isn't retried endlessly even after a worker restart.

### Free providers

Ships with presets — you only enter the key.

**Text:** Google Gemini, Groq, OpenRouter (`:free` models and Gemini via OpenRouter),
Cerebras, Mistral, GitHub Models, your own local server (Ollama / vLLM / RunPod).
**Image:** Pollinations (no key), Gemini, Cloudflare Workers AI, Hugging Face.

## Quality standards

All thresholds live in one file: `src/lib/quality/standards.ts`. The same values are used in
three places — prompt generation, automatic review and revision instructions — so "the prompt
says one thing, the review measures another" never happens.

Defaults: meta title 45–60 chars, meta description 130–158, slug ≤6 words, keyword density
0.5–2.5%, 4–10 H2s, ≥80 words per section, paragraph ≤110 words, sentence ≤34 words,
readability ≥45, at least 3 answered FAQ questions, alt text ≤125 chars.

Scoring weights: meta 25, structure 25, keyword 20, readability 20, richness 10.

### Quality mode (per site)

| Mode | Behavior |
|---|---|
| `AUTONOMOUS` | Measure → get AI editor critique → self-correct findings → re-measure. Default. |
| `CHECK` | Measure and score only; no fixing. |
| `OFF` | No review. |

Posts below the **publish threshold** (default 82) are not auto-published; they go to the
review queue. You can override with "Publish despite warnings."

## Setup (Docker)

```bash
cp .env.example .env
```

Generate the secrets in `.env`:

```bash
openssl rand -hex 32     # ENCRYPTION_KEY
openssl rand -base64 32  # AUTH_SECRET
```

Then:

```bash
docker compose up -d --build
```

Panel: `http://server-address:3000` — login with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.

## Setup (local development)

```bash
npm install
docker compose up -d postgres redis
npx prisma db push
npm run seed
npm run dev
```

In a separate terminal, the worker:

```bash
npm run dev:worker
```

## WordPress side

### 1. Application password

Create one in WordPress under **Users → Profile → Application Passwords**. Enter your
username and this password on the site card in the panel. That's enough to send posts and
images. (Requires HTTPS; if the section is missing it's usually disabled by a security plugin
or SSL not being detected by PHP.)

### 2. dpdai-bridge plugin (recommended)

Needed for SEO meta, Polylang/WPML language linking, idempotent publishing, **site-wide SEO
audit** and **translation tools**. Without it posts still go through but SEO meta can't be
written and audits stay shallow.

**Download from the panel:** the *WordPress bridge plugin* card at the top of Settings has a
**Download plugin** button. The zip is packaged on demand from source.

WordPress → **Plugins → Add New → Upload Plugin** → upload and activate. Then paste the token
from **Tools → DPDAI Bridge** into the site card in the panel.

The plugin self-updates from the panel (no need to upload the zip to 10+ sites one by one).

### 3. Custom PHP sites

Copy `wp-plugin/php-endpoint/dpdai-receive.php` to your site, edit the token and database
settings, and set the platform to **Custom PHP site** in the panel.

## Multilingual & translation (Polylang)

On sites where Polylang is installed you only install the bridge; the bridge auto-detects the
languages. **Siteler → (site) → Translation audit** shows coverage per language, missing and
broken translations, and lets you complete them and translate the navigation menu — all
sector-aware and SEO-optimized while keeping the meaning of the body intact.

## Security

- Site passwords and API keys are encrypted in the database with AES-256-GCM
  (`ENCRYPTION_KEY`). If you lose this key you must re-enter the stored passwords.
- Panel session: HttpOnly cookie + HS256 JWT (`AUTH_SECRET`).
- Model-produced HTML is whitelist-sanitized before it reaches WordPress (script/iframe/style
  and all event attributes dropped, `javascript:` hrefs removed).
- Put HTTPS in front of the panel if you expose it to the internet.

## Directory layout

```
prisma/schema.prisma            data model
src/lib/quality/standards.ts    SINGLE SOURCE: content and image quality thresholds
src/lib/quality/analyze.ts      content review engine (score + revision instructions)
src/lib/providers/pool.ts       API pool: chain, error classification, health tracking
src/lib/providers/text|image/   provider adapters (Claude, OpenAI, Gemini, OpenRouter, …)
src/lib/pipeline/generate.ts    main production pipeline
src/lib/pipeline/quality.ts     autonomous quality loop (critique + fix)
src/lib/pipeline/cover.ts       branded cover image composer
src/lib/pipeline/interlink.ts   internal-link selection and safe placement
src/lib/pipeline/translateExisting.ts  translate existing site content
src/lib/backup.ts               monthly budget cap + automatic pg_dump backup
worker/index.ts                 queue worker and scheduler
wp-plugin/dpdai-bridge/         WordPress bridge plugin (SEO audit, translation, menus, updater)
```

## Roadmap

- Post-publish IndexNow ping and content-refresh loop.
- Inline body images beyond the featured cover.
- Automated test suite for pure-logic modules (analyze, interlink, similarity).
