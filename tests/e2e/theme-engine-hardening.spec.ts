import { expect, test, type Page } from "@playwright/test";

const themes = ["modern", "luxury", "premium_grid", "coffee"] as const;
const widths = [320, 360, 390, 412, 768, 1024, 1440, 1920] as const;
const cardSelector = [
  ".modern-food-card",
  ".premium-luxury-card",
  ".premium-grid-card",
  ".coffee-theme-card",
].join(",");
const infoSelector = [
  ".modern-food-info",
  ".premium-luxury-info",
  ".premium-grid-info",
  ".coffee-theme-info",
].join(",");
const addSelector = [
  ".modern-food-add",
  ".premium-luxury-add",
  ".premium-grid-add",
  ".coffee-theme-add",
].join(",");

function menuPayload(theme: (typeof themes)[number]) {
  const restaurantId = `restaurant-${theme}`;
  const categoryA = `category-a-${theme}`;
  const categoryB = `category-b-${theme}`;
  return {
    restaurant: {
      id: restaurantId,
      name:
        "The Grand International Family Restaurant and Artisan Dining Room",
      slug: `hardening-${theme}`,
      total_tables: 150,
      menu_theme: theme,
      logo_url: "https://images.invalid.example/broken-logo.png",
      cover_url: "https://images.invalid.example/broken-cover.png",
      ordering_settings: {
        theme_customization: {
          version: 1,
          published: {
            branding: {
              accentColor: "#6f3f2a",
              secondaryColor: "#d2ae74",
            },
            typography: {
              headingFont: "elegant_serif",
              bodyFont: "modern_sans",
              fontSize: 15,
            },
            heroLayout: "compact",
            card: {
              radius: "soft_rounded",
              shadow: "shadow",
              imageSize: "medium",
              border: "outline",
            },
            buttons: { style: "filled", shape: "pill" },
            spacing: { card: 14, section: 30, header: 18, image: 8 },
            animation: "minimal",
            colorMode: "light",
          },
          published_at: "2026-07-26T00:00:00.000Z",
        },
      },
    },
    categories: [
      {
        id: categoryA,
        restaurant_id: restaurantId,
        name:
          "Seasonal Chef Specialities and House Favourites for the Whole Family",
        display_order: 1,
        hero_image_url: "https://images.invalid.example/category.png",
      },
      {
        id: categoryB,
        restaurant_id: restaurantId,
        name: "Portrait Plates",
        display_order: 2,
      },
    ],
    items: [
      {
        id: `item-a-${theme}`,
        restaurant_id: restaurantId,
        category_id: categoryA,
        name:
          "Slow Roasted Garden Vegetable and Herb Celebration Platter",
        description: null,
        ingredients: null,
        allergens: null,
        preparation_time_minutes: null,
        calories: null,
        protein_g: null,
        price: 24.5,
        image_url: "https://images.invalid.example/broken-dish.png",
        available: true,
      },
      {
        id: `item-b-${theme}`,
        restaurant_id: restaurantId,
        category_id: categoryB,
        name: "Portrait Breakfast Stack",
        description: "A tall breakfast presentation.",
        ingredients: ["bread", "fruit"],
        allergens: [],
        preparation_time_minutes: 12,
        calories: 420,
        protein_g: 18,
        price: 18,
        image_url:
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='600'%3E%3Crect width='300' height='600' fill='%23c99d67'/%3E%3C/svg%3E",
        available: true,
      },
    ],
  };
}

async function installMenuFixture(
  page: Page,
  theme: (typeof themes)[number],
) {
  await page.route("**/rest/v1/rpc/get_public_qr_menu", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(menuPayload(theme)),
    });
  });
  await page.route("https://images.invalid.example/**", async (route) => {
    await route.fulfill({ status: 404, body: "missing" });
  });
}

for (const theme of themes) {
  test(`${theme} is feature-parity responsive from 320px to 1920px`, async ({
    page,
  }) => {
    await installMenuFixture(page, theme);
    await page.goto(`/r/hardening-${theme}`);

    const surface = page.locator(".theme-customization-surface");
    await expect(surface).toHaveAttribute("data-theme-customized", "true");
    await expect(surface).toHaveAttribute("data-color-mode", "light");
    await expect(page.locator(cardSelector)).toHaveCount(2);

    await page.locator(infoSelector).first().click();
    await expect(page.locator(".food-info-panel")).toBeVisible();
    await expect(page.locator(".food-info-placeholder")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".food-info-panel")).toBeHidden();

    await page.locator(addSelector).first().click();
    await expect(
      page.getByRole("button", { name: /open cart with 1 items/i }).first(),
    ).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search menu" });
    await search.fill("Portrait");
    await expect(page.locator(cardSelector)).toHaveCount(1);
    await search.fill("");
    await expect(page.locator(cardSelector)).toHaveCount(2);

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(180);
      const audit = await page.evaluate((selector) => {
        const documentWidth = document.documentElement.scrollWidth;
        const viewportWidth = document.documentElement.clientWidth;
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(selector),
        ).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
          };
        });
        const clippedButtons = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        )
          .filter((button) => {
            if (!button.getClientRects().length) return false;
            if (
              button.closest(
                ".modern-food-categories, .premium-luxury-categories, .premium-grid-categories, .coffee-theme-categories",
              )
            ) {
              return false;
            }
            const rect = button.getBoundingClientRect();
            return rect.left < -1 || rect.right > window.innerWidth + 1;
          })
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              name: button.getAttribute("aria-label") || button.textContent,
              left: rect.left,
              right: rect.right,
              viewport: window.innerWidth,
              text: button.innerText,
              parent: button.parentElement?.getBoundingClientRect().toJSON(),
              parentParent: button.parentElement?.parentElement
                ?.getBoundingClientRect()
                .toJSON(),
              parentComputed: button.parentElement
                ? {
                    width: getComputedStyle(button.parentElement).width,
                    maxWidth: getComputedStyle(button.parentElement).maxWidth,
                    gridTemplateColumns: getComputedStyle(button.parentElement)
                      .gridTemplateColumns,
                  }
                : null,
              card: button
                .closest<HTMLElement>(selector)
                ?.getBoundingClientRect()
                .toJSON(),
              buttonDisplay: getComputedStyle(button).display,
              buttonMinWidth: getComputedStyle(button).minWidth,
            };
          });
        const overlaps: string[] = [];
        for (let first = 0; first < cards.length; first += 1) {
          for (let second = first + 1; second < cards.length; second += 1) {
            const a = cards[first];
            const b = cards[second];
            const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (horizontal > 1 && vertical > 1) {
              overlaps.push(`${first}:${second}`);
            }
          }
        }
        const reconnect = document.querySelector<HTMLElement>(
          ".qr-realtime-state",
        );
        const search = document.querySelector<HTMLElement>(
          ".modern-food-search, .premium-luxury-search, .premium-grid-search, .coffee-theme-search",
        );
        const reconnectRect = reconnect?.getBoundingClientRect();
        const searchRect = search?.getBoundingClientRect();
        const statusOverlap = Boolean(
          reconnectRect &&
            searchRect &&
            Math.min(reconnectRect.right, searchRect.right) -
              Math.max(reconnectRect.left, searchRect.left) >
              1 &&
            Math.min(reconnectRect.bottom, searchRect.bottom) -
              Math.max(reconnectRect.top, searchRect.top) >
              1,
        );
        return {
          documentWidth,
          viewportWidth,
          clippedButtons,
          overlaps,
          statusOverlap,
          cardWidths: cards.map((card) => card.width),
        };
      }, cardSelector);

      expect(
        audit.documentWidth,
        `${theme} document overflow at ${width}px`,
      ).toBeLessThanOrEqual(audit.viewportWidth + 1);
      expect(
        audit.clippedButtons,
        `${theme} clipped buttons at ${width}px`,
      ).toEqual([]);
      expect(
        audit.overlaps,
        `${theme} card overlap at ${width}px`,
      ).toEqual([]);
      expect(
        audit.statusOverlap,
        `${theme} reconnect status overlap at ${width}px`,
      ).toBe(false);
      expect(
        audit.cardWidths.every((cardWidth) => cardWidth > 0),
        `${theme} collapsed card at ${width}px`,
      ).toBe(true);
    }
  });
}
