# Phase 9.13.15 — Global Smart Image Certification Report

Generated: 2026-07-31 (Africa/Nairobi)

## Certification verdict

**NOT CERTIFIED — remediation required.**

This phase performed no image generation, modification, regeneration, upload, database mutation, or lifecycle transition. The audit found three release-blocking gaps: six approved Breakfast dishes have no master, 18 legacy Breakfast/Ethiopian masters have only the 2048 tier and omit manifest public URLs, and every live Storage response currently returns `cache-control: no-cache` instead of an immutable CDN cache policy.

The required completion statement, `PHASE 9.13.15 COMPLETE — SERVEFLOW GLOBAL SMART IMAGE LIBRARY CERTIFIED`, is intentionally not issued because the evidence does not support it.

## Global totals

| Metric | Result |
| --- | ---: |
| Active approved dish specifications | 151 |
| Master images | 145 |
| Image objects / declared variants | 780 |
| Expected objects at six tiers | 906 |
| Total local storage size | 153,799,962 bytes (146.68 MiB) |
| Master coverage | 96.03% |
| Missing masters | 3.97% (6/151) |
| Six-tier object coverage | 86.09% (780/906) |
| Duplicate dishes | 0 (0.00%) |
| Duplicate checksums/images | 0 (0.00%) |
| Duplicate storage paths | 0 |
| Broken HTTP URLs | 0 |
| Chromium decode failures | 0 |
| Local checksum/file errors | 0 |
| Remote metadata/version errors | 0 |
| Lifecycle errors | 0 |
| CDN cache-policy failures | 780 |

## Category coverage

| Category | Covered / approved | Six responsive tiers | Verdict |
| --- | ---: | --- | --- |
| Breakfast | 8 / 14 | No — 8 masters have only 2048 | FAIL |
| Traditional Ethiopian Dishes | 10 / 10 | No — 10 masters have only 2048 | FAIL |
| Chicken | 5 / 5 | Yes | PASS |
| Fish & Seafood | 4 / 4 | Yes | PASS |
| Pasta | 5 / 5 | Yes | PASS |
| Pizza | 7 / 7 | Yes | PASS |
| Burgers | 4 / 4 | Yes | PASS |
| Sandwiches | 5 / 5 | Yes | PASS |
| Wraps | 3 / 3 | Yes | PASS |
| Rice Dishes | 4 / 4 | Yes | PASS |
| Soups | 5 / 5 | Yes | PASS |
| Salads | 7 / 7 | Yes | PASS |
| Coffee | 4 / 4 | Yes | PASS |
| Tea | 3 / 3 | Yes | PASS |
| Hot Drinks | 2 / 2 | Yes | PASS |
| Fresh Juice | 5 / 5 | Yes | PASS |
| Milkshakes | 5 / 5 | Yes | PASS |
| Cold Drinks | 3 / 3 | Yes | PASS |
| Soft Drinks | 1 / 1 | Yes | PASS |
| Beer | 3 / 3 | Yes | PASS |
| Wine | 3 / 3 | Yes | PASS |
| Whisky | 3 / 3 | Yes | PASS |
| Cocktails | 5 / 5 | Yes | PASS |
| Mocktails | 3 / 3 | Yes | PASS |
| Bread | 4 / 4 | Yes | PASS |
| Bakery | 5 / 5 | Yes | PASS |
| Pastries | 2 / 2 | Yes | PASS |
| Cakes | 5 / 5 | Yes | PASS |
| Desserts | 4 / 4 | Yes | PASS |
| Cookies | 3 / 3 | Yes | PASS |
| Donuts | 3 / 3 | Yes | PASS |
| Cupcakes | 3 / 3 | Yes | PASS |
| Pies | 3 / 3 | Yes | PASS |
| Fries | 2 / 2 | Yes | PASS |
| Snacks | 1 / 1 | Yes | PASS |
| Bar Snacks | 3 / 3 | Yes | PASS |
| Produce | 0 / 0 | Not present in frozen Master Dish Specification Library | NOT APPLICABLE |

## Missing approved masters

All six gaps are in Breakfast:

1. Cereals — `f23ddf9d-4ec4-55fe-ac13-b842959636e7`
2. Continental Breakfast — `8651284f-c5d3-5955-a59b-a5d3183427a0`
3. Ethiopian Breakfast — `ad591395-ff44-5f26-abc9-07995f17eb0b`
4. Fresh Fruits — `cba06f1e-e099-532a-a59d-83f9c90f93b3`
5. Pancake — `84acc56a-4615-5d64-a30a-816d39e25c78`
6. Toast — `ac6eb791-72f6-5179-b880-70b8245c2cb7`

## Responsive and metadata gaps

The following 18 legacy entries have only a 2048×2048 WebP. Their manifests do not declare 1280, 1024, 768, 512, or 320 variants and do not contain a public URL field:

- Breakfast: Chechebsa, Firfir, Ful, Fetira, Omelette, Scrambled Eggs, Kinche, Dulet.
- Traditional Ethiopian Dishes: Kitfo, Tibs, Shekla Tibs, Doro Wot, Key Wot, Gored Gored, Shiro, Misir Wot, Beyaynetu, Tegabino.

This accounts for 90 missing responsive objects. Combined with the 36 objects required for the six entirely missing masters, the global library is 126 objects short of the 906-object six-tier contract.

## Integrity, identity, lifecycle, and storage

- All 780 local files are valid RIFF WebPs and match declared SHA256 and byte size.
- No duplicate dish IDs, dish names, checksums, image payloads, or storage paths were found.
- All 780 paths conform to the frozen restaurant/category/item/v001 hierarchy.
- All deployed versions are immutable `v001` records with matching width, height, MIME type, byte size, and checksum.
- Supabase returned exactly 145 matching Smart Image identities and 780 matching version rows.
- Every deployed identity is `PENDING_REVIEW`, `current_version = 1`; every version is `PENDING_REVIEW`, version 1.
- No unknown or out-of-spec manifest dishes were found.

## Public delivery and performance

- HTTP: 780/780 returned HTTP 200 with `image/webp`.
- Chromium: 780/780 decoded successfully at the declared natural dimensions in an isolated sequential pass.
- CDN cache: 0/780 passed the immutable-cache requirement. Representative responses returned `cache-control: no-cache` and Cloudflare `cf-cache-status: REVALIDATED`.
- HEAD latency across 780 live requests: average 973.4 ms, p50 807.8 ms, p95 1,980.8 ms, maximum 2,535.5 ms.
- A bulk decode pass immediately following the 780-request HTTP sweep was throttled; the independent sequential browser pass then certified all 780 objects. This indicates delivery-rate sensitivity, not corrupt WebPs.

## Rendering certification

The shared `resolveSmartImage` / `SmartImage` path is present and tested across:

- Review Studio and owner menu cards: PASS. Pending masters remain visible only to the owner-review audience, and stale Smart Library drafts refresh without losing owner edits or custom uploads.
- QR Menu: PASS. Cards, featured dishes, food details, idle prefetch, and fallback behavior use the shared engine.
- Waiter ordering: PASS. Menu cards use the shared resolver and renderer.
- Cashier menu: PASS. Cashier menu items use the shared resolver and renderer.
- Owner dashboard: PASS. Owner thumbnails use the owner-review resolver path.
- Theme rendering: PASS. Modern, Premium Luxury, Premium Grid, and Coffee themes use shared resolution, lazy loading, fallback, and virtualization.
- Customer protection: PASS. `PENDING_REVIEW` masters resolve to placeholders for customer audiences and never auto-publish.

## Repository and test validation

| Gate | Result |
| --- | --- |
| Production build | PASS |
| Unit tests | PASS — 645 passed, 0 failed, 16 skipped |
| Regression tests | PASS — 655 passed, 0 failed, 42 skipped |
| Browser regression | PASS — desktop and mobile Chromium projects completed within the regression pipeline |
| Supabase live verification | PASS for all 145 existing identities and 780 versions |
| `git diff --check` | PASS |

The 16 skipped unit/integration checks are guarded live multi-tenant fixtures and are unchanged by this phase. Browser logs intentionally include invalid-image fixtures used to verify fallback and failure reporting.

## Required remediation before certification

1. Authorize a separate image-generation phase for the six missing approved Breakfast dishes. Phase 9.13.15 itself must not generate them.
2. Authorize a non-generation responsive migration for the 18 existing immutable legacy masters, producing the five missing sizes without replacing the 2048 masters, then register immutable version metadata.
3. Add public URLs to the two legacy manifests or migrate them to the current responsive manifest schema.
4. Correct the public Storage/CDN cache policy so immutable `v001` objects return a long-lived cache header, then repeat the 780-object HTTP/cache audit.
5. Decide whether Produce belongs in the frozen specification library. It currently has neither an approved specification nor a master, so it cannot be assessed as a required generated category.
6. Rerun this certification script and issue the completion statement only when all blockers are zero.

## Audit tooling

- `scripts/certify-global-smart-image-library.mjs` — coverage, duplicates, local integrity, Supabase identity/version metadata, HTTP, cache, and bulk browser audit.
- `scripts/certify-global-image-decoding.mjs` — isolated sequential Chromium decoding and dimension certification.
