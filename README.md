# TUCSON 360° Experience
### A Digital Giant prototype for Hyundai Motor Europe

Live demo: [hmevisualizer.netlify.app](https://hmevisualizer.netlify.app)  
Dev preview: [dev--hmevisualizer.netlify.app](https://dev--hmevisualizer.netlify.app)

---

## What this is

A working 360° vehicle visualizer built as a pitch prototype for the IONIQ 3 PIP brief. It's embedded in a mockup of the live Hyundai Motor Europe model page so the client can see exactly what the final product looks like in context.

Built in one session. Runs on a proper platform that scales to any model, trim, or market.

---

## What it does

- **360° exterior spin** — 36-frame image sequence, drag/swipe to rotate, angle preserved on colour switch
- **Equirectangular interior panorama** — WebGL pano viewer, -20° default pitch looking into the cabin, orientation preserved on interior colour switch
- **Colour switching** — 9 exterior colours, 3 interior colours, real Hyundai body panel swatch chips
- **Availability constraints** — Green/Gray 3-Tone interior only shows for the 5 exterior colours it's available with
- **Full preloading** — all 324 spin frames + 23 panos load in the background on page load for instant switching
- **Database-driven** — all colour config loads from Supabase on page load. Add a new colour by inserting a row — no code changes
- **Fallback** — if Supabase is unreachable, hardcoded config kicks in silently

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS — zero dependencies, embeds anywhere |
| 360° spin | HTML5 Canvas API |
| Pano viewer | Pannellum (WebGL, open source) |
| Database | Supabase (Postgres) |
| Hosting | Netlify (auto-deploy on push) |
| Version control | GitHub (main → production, dev → staging) |
| Images | WebP, ~100KB/frame (down from 4MB original JPEGs) |

---

## Repo structure

```
hme-tucson-360-proposal/
├── index.html              — the entire site: page mockup + visualizer + API layer
├── netlify.toml            — Netlify config (caching headers)
└── assets/
    ├── exterior/           — 324 x .webp spin frames (9 colours × 36 frames)
    ├── interior/           — 23 x .webp equirectangular pano images
    └── swatches/           — 12 x .webp swatch chips (9 exterior + 3 interior)
```

Everything is in `index.html`. No build step, no bundler, no framework.

---

## Branch strategy

| Branch | URL | Purpose |
|---|---|---|
| `main` | hmevisualizer.netlify.app | Production — client-facing |
| `dev` | dev--hmevisualizer.netlify.app | Staging — test before merging |

Workflow:
```
make changes → commit to dev → test on dev URL → merge to main → live
```

---

## Database

**Supabase project:** `dg-visualizer-platform`  
**Project ID:** `ifrystxhgelwybaoqxwx`  
**Region:** AWS us-east-2

### Schema overview

```
brands
  └── models
        └── trims
              ├── trim_exterior_colours → exterior_colours
              ├── trim_interior_colours → interior_colours (with optional ext constraint)
              └── trim_wheels          → wheels

assets  (spin_frame | pano | hero | thumbnail | wheel_swatch | env_preview)
environments
packages
```

### Adding a new exterior colour

```sql
-- 1. Insert the colour
insert into exterior_colours (model_id, name, slug, filename_key, hex_primary, sort_order)
values (
  (select id from models where slug = 'tucson-2026'),
  'New Colour Name', 'new-colour-slug', 'NewColourFilenameKey', '#hexcode', 10
);

-- 2. Link it to the trim
insert into trim_exterior_colours (trim_id, exterior_colour_id)
values (
  (select id from trims where slug = 'limited-fwd'),
  (select id from exterior_colours where slug = 'new-colour-slug')
);
```

Then drop the 36 spin frames in `assets/exterior/` and the swatch in `assets/swatches/`.

### Adding a new model (e.g. IONIQ 3)

```sql
insert into models (brand_id, year, name, slug, base_msrp)
values (
  (select id from brands where slug = 'hyundai'),
  2026, 'IONIQ 3', 'ioniq3-2026', 4500000
);
-- Then insert trims, exterior_colours, interior_colours, etc.
```

Point the visualizer at it by changing one line in `index.html`:
```javascript
loadConfig('ioniq3-2026', 'preferred-trim');
```

---

## Asset naming convention

All assets follow this exact pattern (critical — filenames must match):

**Spin frames (exterior):**
```
2026_Tucson_LTD_FWD_{ColourFilenameKey}_Black_360_Landscape_LowerGrand_{NNNN}.webp
```
e.g. `2026_Tucson_LTD_FWD_PhantomBlack_Black_360_Landscape_LowerGrand_0001.webp`

**Interior panoramas:**
```
2026_Tucson_LTD_FWD_{ExtColourFilenameKey}_{IntColourFilenameKey}_Pano_LowerGrand.webp
```
e.g. `2026_Tucson_LTD_FWD_PhantomBlack_Black_Pano_LowerGrand.webp`

**Swatch chips (exterior):**
```
{colour-slug}.webp
```
e.g. `phantom-black.webp`

**Swatch chips (interior):**
```
2026-tucson-limited-fwd-{interior-slug}-leather.webp
```
e.g. `2026-tucson-limited-fwd-black-leather.webp`

---

## Image optimisation

Original renders were 4MB JPEGs. Optimised to WebP using:

```bash
# Exterior spin frames (1920px wide, 82% quality)
for f in *.jpeg; do
  magick "$f" -resize 1920x -strip | cwebp -q 82 -mt - -o "${f%.jpeg}.webp"
done

# Interior panos (4096px wide, 88% quality — higher for pano detail)
for f in *.jpg; do
  magick "$f" -resize 4096x -strip | cwebp -q 88 -mt - -o "${f%.jpg}.webp"
done
```

Result: ~100KB per spin frame (down from 4MB), ~40MB total for all assets.

---

## Deployment

Deploys automatically via Netlify on every push to `main` or `dev`.

**To deploy manually:**
1. Push to `dev` branch
2. Netlify builds in ~30 seconds
3. Test at `dev--hmevisualizer.netlify.app`
4. Merge `dev` → `main` in GitHub Desktop
5. Production URL updates automatically

**To point assets at a CDN (CloudFront, Akamai, etc.):**

Change one line in `index.html`:
```javascript
var BASE = 'https://your-cdn-url.com/tucson-2026';
```

---

## Moving to production (AEM embed)

The visualizer is designed to embed in any CMS as a single script tag:

```html
<div id="dg-visualizer" data-model="tucson-2026" data-trim="limited-fwd"></div>
<script src="https://cdn.digital-giant.com/visualizer/v1/visualizer.js"></script>
```

All styling is via CSS variables — HME reskins by overriding:
```css
:root {
  --brand-primary: #002C5F;
  --brand-accent:  #00AAD2;
}
```

---

## Contact

**Dallas Carroll** — Executive Producer, Digital Giant  
dallas@digital-giant.com  
849 S Broadway, Los Angeles CA

Built for: **Fabienne Moreau**, Hyundai Motor Europe  
Kaiserleipromenade 5, 63067 Offenbach am Main, Germany
