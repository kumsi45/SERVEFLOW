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
  MenuReviewImageVersion,
  MenuInventoryTrackingType,
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
  onTrackingTypeChange: (itemId: string, trackingType: MenuInventoryTrackingType) => void;
  onVisibilityChange: (itemId: string) => void;
  onApprove: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onRestore: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
  onGenerateImage: (itemId: string) => void | Promise<void>;
  onImageDraftChange: (
    itemId: string,
    update: (item: MenuReviewItem) => MenuReviewItem,
  ) => void;
  onOwnerImageUpload: (itemId: string, file: File | null) => void;
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
  onTrackingTypeChange,
  onVisibilityChange,
  onApprove,
  onDelete,
  onRestore,
  onDuplicate,
  onGenerateImage,
  onImageDraftChange,
  onOwnerImageUpload,
}: AiMenuReviewItemCardProps) {
  const disabled = !canEdit || item.deleted;
  const displayName = resolveMenuReviewText(item.name, item.nameLocalization);
  return (
    <article className={`review-item-card${item.deleted ? " deleted" : ""}`}>
      <ImageDraftPanel
        item={item}
        canEdit={canEdit}
        onGenerateImage={onGenerateImage}
        onImageDraftChange={onImageDraftChange}
        onOwnerImageUpload={onOwnerImageUpload}
      />

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
            <span>Inventory Consumption</span>
            <select
              value={item.trackingType ?? "no_tracking"}
              onChange={(event) => onTrackingTypeChange(item.id, event.target.value as MenuInventoryTrackingType)}
              disabled={disabled}
            >
              <option value="no_tracking">No Inventory Tracking</option>
              <option value="recipe">Recipe Item</option>
              <option value="ready_to_sell">Ready-to-Sell Item</option>
            </select>
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
                className={item.hidden ? "visibility-off" : ""}
                onClick={() => onVisibilityChange(item.id)}
                disabled={!canEdit}
              >
                {item.hidden ? "Show to Customers" : "Hide from Customers"}
              </button>
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

function ImageDraftPanel({
  item,
  canEdit,
  onGenerateImage,
  onImageDraftChange,
  onOwnerImageUpload,
}: {
  item: MenuReviewItem;
  canEdit: boolean;
  onGenerateImage: (itemId: string) => void | Promise<void>;
  onImageDraftChange: (
    itemId: string,
    update: (item: MenuReviewItem) => MenuReviewItem,
  ) => void;
  onOwnerImageUpload: (itemId: string, file: File | null) => void;
}) {
  const imageDraft = item.imageDraft;
  const selected = imageDraft.versions.find(
    (version) => version.id === imageDraft.selectedVersionId,
  ) ?? imageDraft.versions[imageDraft.versions.length - 1] ?? null;
  const eligible = item.approved && !item.deleted && !item.hidden && !item.rejected;
  const busy = imageDraft.status === "Generating";

  function selectVersion(versionId: string) {
    const version = imageDraft.versions.find((entry) => entry.id === versionId);
    if (!version) return;
    onImageDraftChange(item.id, (current) => ({
      ...current,
      imageDraft: {
        ...current.imageDraft,
        selectedVersionId: versionId,
        status: version.source === "owner" ? "Owner Upload" : "Ready",
      },
    }));
  }

  function setSelectedStatus(status: MenuReviewImageVersion["status"]) {
    onImageDraftChange(item.id, (current) => ({
      ...current,
      imageDraft: {
        ...current.imageDraft,
        status,
        versions: current.imageDraft.versions.map((version) =>
          version.id === current.imageDraft.selectedVersionId
            ? { ...version, status }
            : version
        ),
      },
    }));
  }

  function cropSelected() {
    onImageDraftChange(item.id, (current) => ({
      ...current,
      imageDraft: {
        ...current.imageDraft,
        versions: current.imageDraft.versions.map((version) =>
          version.id === current.imageDraft.selectedVersionId
            ? { ...version, crop: { x: 0.5, y: 0.5, scale: 1 } }
            : version
        ),
      },
    }));
  }

  function removeSelected() {
    onImageDraftChange(item.id, (current) => {
      const versions = current.imageDraft.versions.filter(
        (version) => version.id !== current.imageDraft.selectedVersionId,
      );
      return {
        ...current,
        imageDraft: {
          ...current.imageDraft,
          status: versions.length ? "Ready" : "Pending",
          selectedVersionId: versions[versions.length - 1]?.id ?? null,
          versions,
          generationProgress: versions.length ? 1 : 0,
        },
      };
    });
  }

  return (
    <section className="review-item-image" aria-label="AI image draft">
      {selected?.thumbnailUrl ? (
        <img
          src={selected.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="review-image-placeholder" role="status">
          <span aria-hidden="true">IMG</span>
          <strong>{imageDraft.errorMessage ? "Image Failed" : "No Image Yet"}</strong>
        </div>
      )}
      <div className="review-image-meta">
        <strong>{imageDraft.status}</strong>
        <small>
          {busy
            ? `${Math.round(imageDraft.generationProgress * 100)}%`
            : `${imageDraft.versions.length} versions`}
        </small>
      </div>
      <progress value={imageDraft.generationProgress} max={1}>
        {Math.round(imageDraft.generationProgress * 100)}%
      </progress>
      {imageDraft.errorMessage ? (
        <small className="review-image-error">{imageDraft.errorMessage}</small>
      ) : null}
      <div className="review-image-actions">
        <button
          type="button"
          onClick={() => void onGenerateImage(item.id)}
          disabled={!canEdit || !eligible || busy}
        >
          {selected ? "Regenerate" : "Generate Image"}
        </button>
        <label>
          Upload Own Image
          <input
            type="file"
            accept="image/*"
            disabled={!canEdit || item.deleted}
            onChange={(event) =>
              onOwnerImageUpload(item.id, event.target.files?.[0] ?? null)}
          />
        </label>
        <button type="button" onClick={() => setSelectedStatus("Approved")} disabled={!canEdit || !selected}>
          Accept
        </button>
        <button type="button" onClick={() => setSelectedStatus("Rejected")} disabled={!canEdit || !selected}>
          Reject
        </button>
        <button type="button" onClick={cropSelected} disabled={!canEdit || !selected}>
          Crop
        </button>
        <button type="button" onClick={removeSelected} disabled={!canEdit || !selected}>
          Remove
        </button>
      </div>
      {imageDraft.versions.length > 1 ? (
        <select
          value={imageDraft.selectedVersionId ?? ""}
          onChange={(event) => selectVersion(event.target.value)}
          aria-label="Compare Versions"
        >
          {imageDraft.versions.map((version) => (
            <option value={version.id} key={version.id}>
              Version {version.version} - {version.status}
            </option>
          ))}
        </select>
      ) : null}
    </section>
  );
}

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
