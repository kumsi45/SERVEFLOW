import type { MenuItem } from "../types";
import { formatNutritionNumber } from "./menuPresentation";

type NutritionSummaryProps = {
  item: Pick<MenuItem, "calories" | "protein_g" | "carbohydrates_g" | "fat_g" | "fiber_g" | "sugar_g" | "sodium_mg">;
  compact?: boolean;
  scope?: "public" | "full";
};

function hasNutritionValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function hasPublicNutrition(item: Pick<MenuItem, "calories" | "protein_g" | "carbohydrates_g" | "fat_g">) {
  return [item.calories, item.protein_g, item.carbohydrates_g, item.fat_g].some(hasNutritionValue);
}

export function hasFullNutrition(item: NutritionSummaryProps["item"]) {
  return [
    item.calories,
    item.protein_g,
    item.carbohydrates_g,
    item.fat_g,
    item.fiber_g,
    item.sugar_g,
    item.sodium_mg,
  ].some(hasNutritionValue);
}

export function NutritionSummary({ item, compact = false, scope = "public" }: NutritionSummaryProps) {
  const nutrition = [
    hasNutritionValue(item.calories) ? { label: "Calories", value: `${formatNutritionNumber(item.calories)} kcal` } : null,
    hasNutritionValue(item.protein_g) ? { label: "Protein", value: `${formatNutritionNumber(item.protein_g)}g` } : null,
    hasNutritionValue(item.carbohydrates_g) ? { label: "Carbs", value: `${formatNutritionNumber(item.carbohydrates_g)}g` } : null,
    hasNutritionValue(item.fat_g) ? { label: "Fat", value: `${formatNutritionNumber(item.fat_g)}g` } : null,
    scope === "full" && hasNutritionValue(item.fiber_g) ? { label: "Fiber", value: `${formatNutritionNumber(item.fiber_g)}g` } : null,
    scope === "full" && hasNutritionValue(item.sugar_g) ? { label: "Sugar", value: `${formatNutritionNumber(item.sugar_g)}g` } : null,
    scope === "full" && hasNutritionValue(item.sodium_mg) ? { label: "Sodium", value: `${formatNutritionNumber(item.sodium_mg)}mg` } : null,
  ].filter((entry): entry is { label: string; value: string } => entry !== null);

  if (nutrition.length === 0) {
    return null;
  }

  return (
    <dl className={compact ? "nutrition-summary compact" : "nutrition-summary"}>
      {nutrition.map((entry) => (
        <div key={entry.label}>
          <dt>{entry.label}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}
