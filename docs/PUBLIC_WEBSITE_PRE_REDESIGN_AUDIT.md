# ServeFlow public website pre-redesign audit

**Audit date:** 2026-10-15  
**Scope:** Read-only audit of the current public marketing and entry surfaces. No production, database, Edge Function, migration, package, deployment, or application-source change was made.

## 1. Executive summary

ServeFlow has a real, locally runnable public landing page and functional entry routes for owner registration and staff sign-in. The landing page has a clear restaurant operations message, a readable visual system, working in-page anchors, and no horizontal overflow in the seven required viewport widths.

It is not ready to act as a trustworthy commercial launch site. At 320px, the rendered mobile-menu button is positioned outside the viewport and cannot be activated. Footer legal and social links are placeholders, public legal routes resolve to the in-app “Menu link not found” state, page metadata remains the generic `SERVEFLOW Menu`, and no sitemap, robots file, canonical URL, social metadata, or page-specific description was found. The price cards make specific plans, free-trial, support, SLA, and integration promises without a verified subscription, checkout, or entitlement path in the inspected registration flow.

The registration flow can create an owner workspace only after a deliberate form submission to the `owner-signup` Edge Function. It was not submitted in this audit. A controlled redesign should first establish truthful positioning and launch-critical routing, legal, metadata, and mobile navigation foundations; it should not expand commercial claims before the related product and operational contracts are verified.

## 2. Existing route inventory

| Path | Component / resolver | Audience | Purpose and observed functionality | State |
| --- | --- | --- | --- | --- |
| `/` | `LandingPage` via `AppRouter` | Prospective hospitality operators | One long-form landing page with anchored Features, How It Works, Pricing, Contact, FAQ, phone links, sign-up, and staff-login links. | PARTIAL |
| `/sign-up` | `OwnerSignupPage` | Prospective owner | Three-step owner and business registration UI. Final submit invokes `owner-signup`; no subscription selection or checkout appears before that call. Rendered locally; not submitted. | PARTIAL |
| `/staff-login` | `StaffLoginPage` | Existing staff | Email/password sign-in, password recovery link, and operational-terminal mode. Rendered locally; credentials were not submitted. | WORKING |
| `/forgot-password` | `ForgotPasswordPage` | Existing staff | Routed by `AppRouter`; source route exists. Browser behavior was not exercised. | UNVERIFIED |
| `/reset-password` | `ResetPasswordPage` | Existing staff with recovery link | Routed by `AppRouter`; source route exists. Browser behavior was not exercised. | UNVERIFIED |
| `#features`, `#how-it-works`, `#pricing`, `#contact`, `#faq` | Landing sections | Landing-page visitors | In-page destinations. Navigation links use smooth scrolling; section elements exist. | WORKING |
| `/privacy-policy` | Fallback route message | Legal visitor | Browser resolves HTTP 200 through Vite fallback, but the app renders “Menu link not found.” Footer does not link here. | MISSING |
| `/terms-of-service` | Fallback route message | Legal visitor | No route or page found. Footer currently points to `#`. | MISSING |
| Dedicated pricing, contact, company, accessibility, cookie, and social destinations | No matching route found | Prospective/customer visitor | Pricing and contact exist only as landing sections. No dedicated public pages or working social destinations found. | MISSING |

The router also exposes customer QR-menu, ordering, staff role, and legacy routes. They are operational product routes, not public marketing pages, and were outside this audit’s interaction scope.

## 3. Page and component architecture

`AppRouter` is a manual `window.location.pathname` resolver. `/` renders `LandingPage`, which composes `NavSection`, `HeroSection`, `TrustSection`, `FeaturesSection`, `HowItWorksSection`, `DashboardPreviewSection`, `BenefitsSection`, `TestimonialsSection`, `PricingSection`, `FaqSection`, `ContactSection`, and `FooterSection`. All landing styles are in `src/modules/landing/styles/landing.css`; entrance effects use Framer Motion.

The architecture is appropriately section-based for a landing-page redesign. It lacks a public-page shell for shared metadata, structured legal pages, public error/404 behavior, locale handling, or route-level SEO configuration.

## 4. UI and UX findings

| Priority | Finding | Evidence and impact |
| --- | --- | --- |
| P0 | Mobile navigation control is off-screen at 320px. | Its measured box was `x=392.9`, `width=14.4`, within a 320px viewport. Playwright timed out trying to click it because it was outside the viewport. Visitors cannot open the mobile menu. |
| P0 | Legal and social destinations are nonfunctional. | Privacy, Terms, X, and LinkedIn use `href="#"`; no legal route/page was found. A direct privacy URL shows “Menu link not found.” |
| P1 | Commercial claims exceed verified integration evidence. | Pricing promises named tiers, “Start free,” “No hidden fees,” support levels, custom integrations, SLA, and 24/7 support. Current CTAs all lead to registration; inspected registration has no plan, trial, billing, checkout, or entitlement selection. |
| P1 | The page uses presentation data that reads as real operational data. | Dashboard cards show exact revenue (`48,320`), order counts, staff activity, queue records, and customer testimonials. They are hard-coded marketing content without visible simulation labels or sourcing. |
| P1 | Information hierarchy repeats and lacks proof. | “Everything Your Restaurant Needs” appears as both Features and Benefits headings; feature cards list capabilities but no product evidence, integration explanation, case study, security explanation, or implementation boundary. |
| P1 | Contact flow is telephone-only. | “Book a Demo” invokes a phone number. No form, email, calendar, response expectation, consent, or fallback contact route is offered. |
| P2 | Motion is not reduced for the landing page. | Landing sections use Framer Motion entry effects. No landing-specific `prefers-reduced-motion` rule was found. Full-page capture before scrolling retained initial hidden states, showing that content relies on viewport animation activation. |
| P2 | The visual language is consistent but dense in decorative dashboard cards. | The dark palette, green accent, typography, cards, and spacing form a coherent base. The future redesign should reduce repeated mock dashboards and make each section answer a visitor decision. |

## 5. Responsive audit

Browser checks used local Chromium at 320, 375, 390, 430, 768, 1024, and 1440 CSS pixels.

| Viewport | Overflow | Observed result | Status |
| --- | --- | --- | --- |
| 320 | None (`scrollWidth=320`) | Landing content fits horizontally; mobile menu button is off-screen and multiple links are below a 24px high target. | PARTIAL |
| 375 | None (`scrollWidth=375`) | No horizontal overflow; mobile menu control remains measured at 14x21px and off-screen. | PARTIAL |
| 390 | None (`scrollWidth=390`) | No horizontal overflow; mobile navigation remains unusable. | PARTIAL |
| 430 | None (`scrollWidth=430`) | No horizontal overflow; mobile navigation remains unusable. | PARTIAL |
| 768 | None (`scrollWidth=768`) | No horizontal overflow. Footer and phone targets remain 19px high. | PARTIAL |
| 1024 | None (`scrollWidth=1024`) | No horizontal overflow. Desktop navigation text links are 19px high. | PARTIAL |
| 1440 | None (`scrollWidth=1440`) | No horizontal overflow. Desktop layout is visually coherent after scrolling activates entrance effects. | PARTIAL |

No overlap or clipping was observed in the scroll-activated local captures. The mobile control failure and undersized targets still block responsive launch quality.

## 6. Accessibility review

Positive evidence: the page has one rendered H1, meaningful section headings, landmark-like `main`, `nav`, and `footer` elements, labelled navigation, labelled FAQ expansion controls, named telephone links, and keyboard focus falls on the home link with the browser’s visible outline.

Gaps:

- The 320px menu toggle has an accessible name and `aria-expanded`, but is visually off-screen and therefore inaccessible by pointer.
- Measured targets include a 14x21px menu button and 19px-high phone/footer/nav links. These fall short of common 24px minimum and 44px touch-target guidance.
- No landing-specific `:focus-visible` treatment or reduced-motion preference handling was found.
- Decorative logo images correctly use empty alt text, and the contact image has an alt name; no evidence was found that testimonials, prices, and dashboard figures are described as illustrative.
- No automated WCAG contrast, screen-reader, zoom, language, or keyboard traversal audit was performed. These remain UNVERIFIED.

## 7. SEO review

The document title rendered as `SERVEFLOW Menu` on `/`, `/sign-up`, and `/staff-login`. It does not describe the landing-page service. No page-specific description, canonical link, Open Graph/Twitter metadata, robots file, sitemap, structured data, or public 404 page was found in the inspected sources. The app is a client-side path resolver, so metadata is currently not route-specific.

Required redesign foundations: per-page title/description/canonical management, `robots.txt`, XML sitemap, social preview metadata, Organization/SoftwareApplication structured data only when factual, clear indexability policy for authenticated and QR/order routes, and a branded 404 route returning an appropriate deployment response.

## 8. Hospitality positioning review

The current copy consistently addresses restaurants, cafes, hotel F&B outlets, food courts, and fast-food counters. It does not substantively address bars/lounges, coffee shops beyond cafes, lodges beyond hotel F&B, or other hospitality models. Hotel language implies multi-restaurant handling through an unattributed testimonial but does not define the operational scope.

Recommended positioning for redesign: describe ServeFlow as an operations platform for restaurants, cafes and coffee shops, bars and lounges, hotel and lodge food-and-beverage outlets, and related hospitality venues **where the verified workflow applies**. Use segment pages only after each segment’s supported workflows, constraints, and customer proof are verified. Do not claim property management, room service, reservation management, housekeeping, multi-property administration, printer reliability, multilingual operation, or future Super Admin capability without separate evidence.

## 9. Authentication and registration integration review

Public calls to action link to `/sign-up`; sign-in links reach `/staff-login`. The owner sign-up UI collects business name, owner name, email, and password. On final submission, it invokes the `owner-signup` Edge Function with a generated restaurant slug and `tableCount: null`, then routes the successful user to staff login for guided setup. This is a real integration path in source, but it was not submitted and no hosted verification was performed.

The registration surface has no disclosed plan selection, trial duration, billing terms, payment collection, eligibility validation, legal acceptance, consent record, or customer-facing account recovery explanation. Social sign-in controls are labelled as coming soon. The redesign should keep sign-up as a separate conversion flow, but align every pricing/CTA promise with server-enforced onboarding, subscriptions, and terms acceptance before making commercial claims.

## 10. Unsupported or misleading claims

- Tier prices of `49` and `99` per month lack currency, tax treatment, billing frequency detail beyond `/mo`, trial length, cancellation terms, and a verified purchase path.
- “Start free,” “Start Free Trial,” “No hidden fees,” “Email support,” “Priority support,” “Dedicated account manager,” “Custom integrations,” “SLA & 24/7 support,” and unlimited-account promises lack verified public commercial and entitlement evidence.
- “Trusted by Restaurant Owners” and the three named testimonials have no displayed attribution, consent, or source evidence.
- Exact dashboard revenue, order counts, and statuses are illustrative values but are not marked illustrative.
- “Cloud Management” and “securely from any device, anywhere in the world” are broad operational/security claims without published availability, security, device, or regional limitations.
- Current copy should not be extended to claim printer support, multilingual English/Afaan Oromoo/Amharic support, Super Admin capability, or hotel/lodge functions beyond verified food-and-beverage workflows.

## 11. Reusable assets and foundations

- Section composition and `lp-*` class namespace provide a contained foundation for a landing redesign.
- Shared `lp-container`, button styles, section header treatment, card styles, FAQ disclosure pattern, and responsive grid breakpoints can be retained after accessibility corrections.
- `serveflowlogo.png`, `serveflow-auth-hospitality.png`, and `contact.jpg` are existing public assets; usage rights and optimization were not verified.
- Owner sign-up and staff-login routes already supply conversion and returning-user entry points.

## 12. Launch blockers, prioritized

1. **P0 — Repair mobile navigation:** make the menu button visible, keyboard-reachable, and at least an appropriate touch size at 320–430px; test opened/closed states.
2. **P0 — Supply working legal destinations:** publish approved privacy and terms content, route it, and replace placeholder footer links. Add a factual contact/privacy path before collecting registrations.
3. **P1 — Reconcile pricing and CTA claims:** remove or qualify unsupported plan/trial/support/SLA/integration promises until a reviewed subscription, entitlement, checkout, and support process exists.
4. **P1 — Correct SEO and public errors:** set factual route-specific titles/descriptions, canonical URLs, robots/sitemap policy, social metadata, and a real 404 surface.
5. **P1 — Establish customer-proof standards:** replace unverified testimonials and pseudo-live figures with approved proof or clearly labelled illustrative examples.
6. **P2 — Meet interaction and motion needs:** enlarge targets, add landing focus-visible styles and reduced-motion handling, then test keyboard, screen reader, zoom, and contrast.

## 13. Recommended sitemap and navigation

**Primary navigation:** Product, Solutions, Pricing (only after commercial verification), Resources, Contact/Demo, Sign in, Start setup.

**Recommended public sitemap:**

- `/` — concise value proposition and conversion path
- `/product` — verified workflow overview
- `/solutions/restaurants`, `/solutions/cafes-coffee-shops`, `/solutions/bars-lounges`, `/solutions/hotel-lodge-f-and-b` — only for verified use cases
- `/how-it-works` — factual implementation and onboarding explanation
- `/pricing` — only with approved commercial terms and subscription integration
- `/contact` or `/demo` — accessible demo/contact form with clear response expectations
- `/resources` and factual customer stories only when available
- `/privacy-policy`, `/terms-of-service`, and any required cookie notice
- `/sign-up`, `/staff-login`, `/forgot-password`, `/reset-password`

Keep QR menus, ordering, and role workspaces outside marketing navigation and protected according to their actual access model.

## 14. Recommended redesign sequence

1. Confirm product, segment, legal, pricing, support, and subscription facts with the responsible owners.
2. Define public information architecture, conversion routes, language strategy, analytics/privacy requirements, and a content-evidence register.
3. Build the public shell: responsive header/menu, footer, legal routes, public 404, metadata, sitemap/robots, and accessible design tokens.
4. Redesign the home page around factual problem, verified workflows, target hospitality segments, proof, and one clear demo/setup decision.
5. Connect or deliberately defer pricing, demo/contact, and registration conversion paths; do not make a CTA promise the platform cannot fulfil.
6. Add localized content architecture for English, Afaan Oromoo, and Amharic before translation work. Do not claim availability until content, UI, routes, and quality review exist.
7. Run browser/device, keyboard, screen-reader, contrast, performance, SEO, auth-registration, and hosted deployment checks before launch.

## 15. Deferred features and claims

- Super Admin public positioning and workflows.
- English, Afaan Oromoo, and Amharic language selector and translations.
- Printer capability, setup, reliability, and support statements.
- Hospitality segments beyond verified restaurant and food-and-beverage workflows.
- Payments/subscriptions, free trials, invoices, tax, cancellation, SLA, support, integrations, and account-management claims.
- Customer stories, review integrations, and live product data until approved evidence exists.

## 16. Test commands and outcomes

| Command / check | Count | Outcome |
| --- | ---: | --- |
| `git diff --check` before audit edit | 1 | PASS; no whitespace errors in the pre-existing tree. |
| Local Vite HTTP check at `http://127.0.0.1:4175/` | 1 | PASS; HTTP 200. |
| Read-only Chromium landing-page render across 320, 375, 390, 430, 768, 1024, and 1440px | 7 viewports | PASS for load, one H1, no captured console errors, and no horizontal overflow. |
| Read-only Chromium keyboard-focus sample | 7 viewports | PASS; initial focus reached the labelled home link with browser outline. This is not a full keyboard audit. |
| Read-only Chromium target-size measurement | 7 viewports | FINDING; undersized controls were detected at every width. |
| Read-only Chromium mobile-menu activation at 320px | 1 interaction | FAIL; menu toggle box was outside the viewport (`x=392.9` in a 320px viewport), so Playwright could not click it. |
| Read-only route render check | 3 routes | `/sign-up` and `/staff-login` rendered their expected headings; `/privacy-policy` rendered “Menu link not found.” |
| Scroll-activated local visual capture | 1 completed 320px capture | PASS for revealed section content after scrolling. A broader script was interrupted by the confirmed mobile-menu failure. |
| `npm run build` | 1 | PASS; `tsc -b` and Vite completed. Vite reported existing chunks over 500kB after minification. |

No form was submitted, no authentication attempt was made, and no database/API mutation test was run.

## 17. Files inspected

- `package.json`, `index.html`, `playwright.config.ts`, and `src/app/router/AppRouter.tsx`
- `src/modules/landing/pages/LandingPage.tsx`
- All files in `src/modules/landing/sections/` and `src/modules/landing/styles/landing.css`
- `src/modules/owner-signup/pages/OwnerSignupPage.tsx`
- `src/modules/staff-auth/pages/StaffLoginPage.tsx` and related route/service references
- Relevant route, localization, SEO, subscription, and public-link search results under `src/`, `public/`, and `supabase/`

## 18. Files changed

- `docs/PUBLIC_WEBSITE_PRE_REDESIGN_AUDIT.md` — this audit report only.

## 19. Limitations

This is a local source and browser audit. It does not verify hosted domains, DNS, TLS, production headers, indexation, analytics, consent management, email/SMS delivery, legal approval, real customer references, payments/subscriptions, Edge Function behavior after form submission, authentication with real credentials, device hardware, assistive technologies, or production performance. The previously existing working-tree changes were preserved.

PUBLIC WEBSITE AUDIT COMPLETE — READY FOR REDESIGN PLANNING
