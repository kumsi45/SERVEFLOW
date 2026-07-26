import { memo } from "react";
import { formatConfidence } from "../services/menuExtractionTypes";
import type {
  MenuReviewCategory,
  MenuReviewItem,
  MenuReviewWarning,
} from "../services/menuReviewTypes";

type AiMenuReviewItemCardProps = {
  item: MenuReviewItem;
  categories: MenuReviewCategory[];
  warnings: MenuReviewWarning[];
  canEdit: boolean;
  selected: boolean;
  onSelect: (itemId: string, selected: boolean) => void;
  onTextChange: (
    itemId: string,
    field: "name" | "description" | "currency" | "notes",
    value: string,
  ) => void;
  onPriceChange: (itemId: string, value: string) => void;
  onCategoryChange: (itemId: string, categoryId: string | null) => void;
  onApprove: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onRestore: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
};

export const AiMenuReviewItemCard = memo(function AiMenuReviewItemCard({
  item,
  categories,
  warnings,
  canEdit,
  selected,
  onSelect,
  onTextChange,
  onPriceChange,
  onCategoryChange,
  onApprove,
  onDelete,
  onRestore,
  onDuplicate,
}: AiMenuReviewItemCardProps) {
  const disabled = !canEdit || item.deleted;
  return (
    <article className={`review-item-card${item.deleted ? " deleted" : ""}`}>
      <div className="review-item-image" aria-label="No image assigned">
        <span aria-hidden="true">IMG</span>
        <strong>No Image Yet</strong>
      </div>

      <div className="review-item-card-body">
        <header className="review-item-heading">
          <label className="review-item-select">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelect(item.id, event.target.checked)}
              disabled={!canEdit}
              aria-label={`Select ${item.name.value || "unnamed item"}`}
            />
            Select
          </label>
          <span className={item.approved ? "approved" : "pending"}>
            {item.deleted ? "Deleted" : item.approved ? "Approved" : "Needs review"}
          </span>
        </header>

        {warnings.length > 0 ? (
          <div className="review-item-warnings" aria-label="Item warnings">
            {warnings.map((warning) => <span key={warning}>{warning}</span>)}
          </div>
        ) : (
          <div className="review-item-clear">No warnings</div>
        )}

        <div className="review-item-fields">
          <label>
            <span>
              Food Name
              <small>{formatConfidence(item.name.confidence)}</small>
            </span>
            <input
              value={item.name.value ?? ""}
              onChange={(event) =>
                onTextChange(item.id, "name", event.target.value)}
              disabled={disabled}
              placeholder="Food name"
            />
          </label>
          <label>
            <span>
              Category
              <small>{formatConfidence(item.categoryConfidence)}</small>
            </span>
            <select
              value={item.categoryId ?? ""}
              onChange={(event) =>
                onCategoryChange(item.id, event.target.value || null)}
              disabled={disabled}
            >
              <option value="">Missing Category</option>
              {categories.map((category) => (
                <option value={category.id} key={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              Price
              <small>{formatConfidence(item.price.confidence)}</small>
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={item.price.value ?? ""}
              onChange={(event) => onPriceChange(item.id, event.target.value)}
              disabled={disabled}
              placeholder="Missing"
            />
          </label>
          <label>
            <span>
              Currency
              <small>{formatConfidence(item.currency.confidence)}</small>
            </span>
            <input
              value={item.currency.value ?? ""}
              onChange={(event) =>
                onTextChange(item.id, "currency", event.target.value)}
              disabled={disabled}
              placeholder="e.g. ETB"
              maxLength={20}
            />
          </label>
          <label className="wide">
            <span>
              Description
              <small>{formatConfidence(item.description.confidence)}</small>
            </span>
            <textarea
              value={item.description.value ?? ""}
              onChange={(event) =>
                onTextChange(item.id, "description", event.target.value)}
              disabled={disabled}
              placeholder="Missing description"
              rows={2}
            />
          </label>
          <label className="wide">
            <span>
              Notes
              <small>{formatConfidence(item.notes.confidence)}</small>
            </span>
            <textarea
              value={item.notes.value ?? ""}
              onChange={(event) =>
                onTextChange(item.id, "notes", event.target.value)}
              disabled={disabled}
              placeholder="Optional notes"
              rows={2}
            />
          </label>
        </div>

        <div className="review-item-actions">
          {item.deleted ? (
            <button
              type="button"
              onClick={() => onRestore(item.id)}
              disabled={!canEdit}
            >
              Restore Item
            </button>
          ) : (
            <>
              <button
                type="button"
                className={item.approved ? "approved" : ""}
                onClick={() => onApprove(item.id)}
                disabled={!canEdit}
              >
                {item.approved ? "Undo Approval" : "Approve"}
              </button>
              <button
                type="button"
                onClick={() => onDuplicate(item.id)}
                disabled={!canEdit}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => onDelete(item.id)}
                disabled={!canEdit}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
});

