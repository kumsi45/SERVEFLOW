import { useEffect, useState } from "react";
import { formatPreparationEstimate } from "../../../core/menu/preparationTime";
import type { MenuItem } from "../types";
import { IngredientList } from "./IngredientList";
import { formatMenuPrice } from "./menuPresentation";
import { hasFullNutrition, NutritionSummary } from "./NutritionSummary";

type FoodInfoPanelProps = {
  item?: MenuItem;
  onClose: () => void;
  onAddToCart?: (item: MenuItem, quantity: number, notes?: string) => void;
};

type ExtendedMenuItem = MenuItem & {
  serving_size?: string | null;
  origin_country?: string | null;
};

function cleanList(values: string[] | null | undefined) {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

function DetailChipSection({
  title,
  values,
  warning = false,
}: {
  title: string;
  values: string[] | null | undefined;
  warning?: boolean;
}) {
  const clean = cleanList(values);

  if (clean.length === 0) {
    return null;
  }

  return (
    <section className="food-info-section" aria-label={title}>
      <h3>{title}</h3>
      <div className="food-info-chip-row">
        {clean.map((value) => (
          <span className={warning ? "food-info-chip warning" : "food-info-chip"} key={value}>
            {value}
          </span>
        ))}
      </div>
    </section>
  );
}

function SpiceLevel({ value }: { value: number | null | undefined }) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const level = Math.min(5, Math.max(1, Math.round(value)));

  return (
    <section className="food-info-section" aria-label="Spice level">
      <h3>Spice Level</h3>
      <div className="spice-level-meter">
        {Array.from({ length: 5 }).map((_, index) => (
          <span className={index < level ? "active" : ""} key={index} aria-hidden="true">
            ●
          </span>
        ))}
        <strong>{level}/5</strong>
      </div>
    </section>
  );
}

export function FoodInfoPanel({ item, onClose, onAddToCart }: FoodInfoPanelProps) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setQuantity(1);
    setNotes("");
  }, [item?.id]);

  if (!item) {
    return null;
  }

  const extendedItem = item as ExtendedMenuItem;
  const imageUrl = item.effective_image_url || item.image_url;
  const preparationEstimate = formatPreparationEstimate(item.preparation_time_minutes);
  const hasServingDetails = Boolean(extendedItem.serving_size || extendedItem.origin_country);

  return (
    <div className="food-info-layer" role="presentation">
      <button
        className="food-info-backdrop"
        type="button"
        aria-label="Close food information"
        onClick={onClose}
      />
      <aside className="food-info-panel" aria-label={`${item.name} food information`}>
        <div className="food-info-topbar">
          <button className="panel-close-button" type="button" onClick={onClose} aria-label="Close food information">
            Back
          </button>
          <strong>Dish Information</strong>
        </div>

        <div className="food-info-media">
          {imageUrl ? (
            <img src={imageUrl} alt={item.name} loading="eager" decoding="async" />
          ) : (
            <div className="food-info-placeholder" aria-hidden="true" />
          )}
        </div>

        <div className="food-info-body">
          <div className="food-info-heading">
            <div>
              <h2>{item.name}</h2>
              {item.description ? <p>{item.description}</p> : null}
            </div>
            <strong>{formatMenuPrice(Number(item.price))}</strong>
          </div>

          <IngredientList ingredients={item.ingredients} />

          {hasFullNutrition(item) ? (
            <section className="food-info-section" aria-label="Nutrition">
              <h3>Nutrition</h3>
              <NutritionSummary item={item} scope="full" />
            </section>
          ) : null}

          <DetailChipSection title="Allergens" values={item.allergens} warning />
          <SpiceLevel value={item.spice_level} />

          {preparationEstimate ? (
            <section className="food-info-section" aria-label="Estimated preparation time">
              <h3>Preparation Time</h3>
              <p className="prep-time-display">{preparationEstimate}</p>
            </section>
          ) : null}

          <DetailChipSection title="Dietary Info" values={item.dietary_tags} />

          {hasServingDetails ? (
            <section className="food-info-section" aria-label="Serving details">
              <h3>Serving Details</h3>
              <dl className="food-info-detail-list">
                {extendedItem.serving_size ? (
                  <div>
                    <dt>Serving Size</dt>
                    <dd>{extendedItem.serving_size}</dd>
                  </div>
                ) : null}
                {extendedItem.origin_country ? (
                  <div>
                    <dt>Origin Country</dt>
                    <dd>{extendedItem.origin_country}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          <label className="food-info-notes">
            <span>Special instructions</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="No onions, extra spice, allergy notes..."
              maxLength={160}
            />
          </label>
        </div>

        <div className="food-info-order-row">
          <div className="quantity-stepper" aria-label="Quantity">
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
            >
              -
            </button>
            <span>{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((current) => Math.min(99, current + 1))}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          <button
            className="food-info-add-button"
            type="button"
            disabled={!item.available}
            onClick={() => onAddToCart?.(item, quantity, notes)}
          >
            <span>{item.available ? "Add to Order" : "Unavailable"}</span>
            <strong>{formatMenuPrice(Number(item.price) * quantity)}</strong>
          </button>
        </div>
      </aside>
    </div>
  );
}

