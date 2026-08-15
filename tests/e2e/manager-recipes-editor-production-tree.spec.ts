import { expect, test } from "@playwright/test";

for (const mode of ["setup", "edit"] as const) {
  test(`real RecipeEditor keeps Ingredients operational after ${mode} state settles`, async ({ page }) => {
    await page.goto(`/tests/e2e/fixtures/recipe-editor-harness.html?mode=${mode}`);

    const section = page.getByRole("region", { name: "Recipe ingredients" });
    await expect(section).toBeVisible();
    await expect(section.getByRole("button", { name: "+ Add Ingredient" })).toHaveCount(1);

    if (mode === "edit") {
      await expect(section.getByText("Loading ingredients...")).toBeVisible();
      await expect(section.getByText("Cooking Oil", { exact: true })).toBeVisible();
      await expect(section.getByText("20", { exact: true })).toBeVisible();
      await expect(section.getByText("ml", { exact: true }).first()).toBeVisible();
      await expect(section.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(section.getByRole("button", { name: "Remove" })).toBeVisible();
    } else {
      await expect(section.getByText("No ingredients added yet.")).toBeVisible();
    }

    await section.getByRole("button", { name: "+ Add Ingredient" }).click();
    await section.getByLabel("Search Inventory").fill("mango");
    const result = section.getByRole("button", { name: /Mango/ });
    await expect(result).toBeVisible();
    await result.click();
    await expect(section.getByText("Selected inventory item")).toBeVisible();
    await expect(section.locator('[data-selected-inventory-item-id="item-mango"]')).toBeVisible();

    const geometry = await section.evaluate((element) => {
      const review = document.querySelector<HTMLElement>(".mrw-review");
      const rect = element.getBoundingClientRect();
      return { height: rect.height, beforeReview: review ? rect.bottom <= review.getBoundingClientRect().top : true, pageOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.height).toBeGreaterThan(180);
    expect(geometry.beforeReview).toBe(true);
    expect(geometry.pageOverflow).toBe(false);
  });
}
