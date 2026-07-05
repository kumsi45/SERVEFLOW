import type { MenuItem } from "../types";

type IngredientListProps = {
  ingredients: MenuItem["ingredients"];
};

function cleanIngredients(ingredients: MenuItem["ingredients"]) {
  return (ingredients ?? [])
    .map((ingredient) => ingredient.trim())
    .filter((ingredient) => ingredient.length > 0);
}

function formatIngredientName(ingredient: string) {
  return ingredient
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function IngredientList({ ingredients }: IngredientListProps) {
  const clean = cleanIngredients(ingredients);

  if (clean.length === 0) {
    return null;
  }

  return (
    <section className="food-info-section" aria-label="Ingredients">
      <h3>Ingredients</h3>
      <ul className="ingredient-check-list">
        {clean.map((ingredient) => (
          <li key={ingredient}>
            <span aria-hidden="true">✓</span>
            {formatIngredientName(ingredient)}
          </li>
        ))}
      </ul>
    </section>
  );
}
