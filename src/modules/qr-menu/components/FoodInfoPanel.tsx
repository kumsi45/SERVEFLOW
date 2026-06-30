import { useEffect, useState } from "react";
import type { MenuItem } from "../types";
import { formatETBPrice } from "./menuPresentation";

type FoodInfoPanelProps = {
  item?: MenuItem;
  onClose: () => void;
  onAddToCart?: (item: MenuItem, quantity: number, notes?: string) => void;
};

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

  return (
    <div className="food-info-layer" role="presentation">
      <button
        className="food-info-backdrop"
        type="button"
        aria-label="Close food information"
        onClick={onClose}
      />
      <aside className="food-info-panel" aria-label={`${item.name} food information`}>
        <div className="food-info-media">
          {item.image_url ? (
            <img src={item.image_url} alt={item.name} />
          ) : (
            <div className="food-info-placeholder" aria-hidden="true" />
          )}
          <button className="panel-close-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="food-info-heading">
          <div>
            <p className="eyebrow">Item Details</p>
            <h2>{item.name}</h2>
            {item.description ? <p>{item.description}</p> : null}
          </div>
          <strong>{formatETBPrice(Number(item.price))}</strong>
        </div>

        <label className="food-info-notes">
          <span>Notes for the kitchen</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="No onions, extra spice, allergy notes..."
            maxLength={160}
          />
        </label>

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
            {item.available ? "Add To Cart" : "Unavailable"}
          </button>
        </div>
      </aside>
    </div>
  );
}
