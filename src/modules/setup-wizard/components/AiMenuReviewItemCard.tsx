import { memo, useState, type ChangeEvent } from "react";
import {
  MENU_LANGUAGE_OPTIONS,
  isMenuLanguage,
  type MenuLanguage,
} from "../../../core/menu/menuLanguage";
import { formatConfidence } from "../services/menuExtractionTypes";
import { resolveMenuReviewText } from "../services/menuReviewState";
import type {
  MenuReviewCategory,
  MenuReviewItem,
  MenuReviewLocalization,
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
    language?: MenuLanguage,
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
  const displayName = resolveMenuReviewText(item.name, item.nameLocalization);
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
              aria-label={`Select ${displayName || "unnamed item"}`}
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
          <LocalizedTextEditor
            label="Food Name"
            source={item.name}
            localization={item.nameLocalization}
            disabled={disabled}
            onChange={(language, value) =>
              onTextChange(item.id, "name", value, language)}
          />
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
          <LocalizedTextEditor
            label="Description"
            source={item.description}
            localization={item.descriptionLocalization}
            disabled={disabled}
            multiline
            onChange={(language, value) =>
              onTextChange(item.id, "description", value, language)}
          />
          <LocalizedTextEditor
            label="Notes"
            source={item.notes}
            localization={item.notesLocalization}
            disabled={disabled}
            multiline
            onChange={(language, value) =>
              onTextChange(item.id, "notes", value, language)}
          />
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

function LocalizedTextEditor({
  label,
  source,
  localization,
  disabled,
  multiline = false,
  onChange,
}: {
  label: string;
  source: { value: string | null; confidence: number };
  localization: MenuReviewLocalization;
  disabled: boolean;
  multiline?: boolean;
  onChange: (language: MenuLanguage, value: string) => void;
}) {
  const initialLanguage = isMenuLanguage(localization.detectedLanguage)
    ? localization.detectedLanguage
    : "en";
  const [language, setLanguage] = useState<MenuLanguage>(initialLanguage);
  const field = localization.values[language];
  const inputProps = {
    value: field.value ?? "",
    onChange: (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(language, event.target.value),
    disabled,
    placeholder: "Not translated yet.",
  };
  return (
    <fieldset className="review-localized-field">
      <legend>
        {label}
        <small>{formatConfidence(field.confidence)}</small>
      </legend>
      <div className="review-language-tabs" aria-label={`${label} language`}>
        {MENU_LANGUAGE_OPTIONS.map((option) => (
          <button
            type="button"
            className={language === option.code ? "active" : ""}
            onClick={() => setLanguage(option.code)}
            aria-pressed={language === option.code}
            key={option.code}
          >
            {option.label}
          </button>
        ))}
      </div>
      {multiline
        ? <textarea {...inputProps} rows={2} />
        : <input {...inputProps} />}
      <small className="review-detected-language">
        Detected: {localization.detectedLanguage} ·{" "}
        {formatConfidence(localization.languageConfidence)} · Source preserved
        {source.value ? `: ${source.value}` : ""}
      </small>
    </fieldset>
  );
}
