import type { MenuItem } from "../types";
import { getFoodInfo } from "./foodInfoPresentation";

type FoodInfoPanelProps = {
  item?: MenuItem;
  onClose: () => void;
};

export function FoodInfoPanel({ item, onClose }: FoodInfoPanelProps) {
  if (!item) {
    return null;
  }

  const foodInfo = getFoodInfo(item);

  return (
    <div className="food-info-layer" role="presentation">
      <button
        className="food-info-backdrop"
        type="button"
        aria-label="Close food information"
        onClick={onClose}
      />
      <aside className="food-info-panel" aria-label={`${item.name} food information`}>
        <div className="food-info-heading">
          <div>
            <p className="eyebrow">Food Info</p>
            <h2>{item.name}</h2>
          </div>
          <button className="panel-close-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="food-info-section">
          <h3>Description</h3>
          <p>{foodInfo.description}</p>
        </section>

        <section className="food-info-section">
          <h3>Ingredients</h3>
          {foodInfo.ingredients.length > 0 ? (
            <ul className="food-info-list">
              {foodInfo.ingredients.map((ingredient) => (
                <li key={ingredient}>{ingredient}</li>
              ))}
            </ul>
          ) : (
            <p>Ingredient information unavailable.</p>
          )}
        </section>

        <section className="food-info-section">
          <h3>Allergens</h3>
          {foodInfo.allergens.length > 0 ? (
            <div className="food-info-chip-row">
              {foodInfo.allergens.map((allergen) => (
                <span className="food-info-chip warning" key={allergen}>
                  {allergen}
                </span>
              ))}
            </div>
          ) : (
            <p>No known allergen information.</p>
          )}
        </section>

        {foodInfo.dietaryLabels.length > 0 ? (
          <section className="food-info-section">
            <h3>Dietary Labels</h3>
            <div className="food-info-chip-row">
              {foodInfo.dietaryLabels.map((label) => (
                <span className="food-info-chip" key={label}>
                  {label}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
