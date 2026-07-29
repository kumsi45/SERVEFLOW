import { memo, type ChangeEvent } from "react";
import { resolveMenuReviewText } from "../services/menuReviewState";
import type { MenuReviewCategory, MenuReviewItem } from "../services/menuReviewTypes";

type Props = {
  item: MenuReviewItem;
  categories: MenuReviewCategory[];
  selected: boolean;
  canEdit: boolean;
  onSelect: (selected: boolean) => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPriceChange: (value: string) => void;
  onCategoryChange: (categoryId: string) => void;
  onPhotoChange: (file: File | null) => void;
  onPhotoRemove: () => void;
  onRemove: () => void;
};

export const OwnerMenuItemCard = memo(function OwnerMenuItemCard({
  item,
  categories,
  selected,
  canEdit,
  onSelect,
  onNameChange,
  onDescriptionChange,
  onPriceChange,
  onCategoryChange,
  onPhotoChange,
  onPhotoRemove,
  onRemove,
}: Props) {
  const name = resolveMenuReviewText(item.name, item.nameLocalization);
  const description = resolveMenuReviewText(item.description, item.descriptionLocalization);
  const selectedPhoto = item.imageDraft.versions.find(
    (version) => version.id === item.imageDraft.selectedVersionId,
  );
  const photoUrl = selectedPhoto?.imageUrl ?? selectedPhoto?.thumbnailUrl ?? null;
  const priceMissing = item.price.value === null;

  function changePhoto(event: ChangeEvent<HTMLInputElement>) {
    onPhotoChange(event.target.files?.[0] ?? null);
    event.target.value = "";
  }

  return (
    <article className={`owner-menu-card${priceMissing ? " price-missing" : ""}`}>
      <label className="owner-menu-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
          disabled={!canEdit}
        />
        <span>Select {name || "menu item"}</span>
      </label>

      <div className="owner-menu-photo">
        {photoUrl ? <img src={photoUrl} alt="" /> : <span aria-hidden="true">{name.trim().slice(0, 1) || "M"}</span>}
        <label className="owner-photo-camera" title="Change photo">
            <span aria-hidden="true">📷</span>
            <span className="setup-visually-hidden">Change Photo</span>
            <input type="file" accept="image/*" onChange={changePhoto} disabled={!canEdit} />
        </label>
        <button type="button" onClick={onPhotoRemove} disabled={!canEdit || !photoUrl}>Remove Photo</button>
      </div>

      <div className="owner-menu-main-fields">
        <label>
          <span>Food Name</span>
          <input value={name} onChange={(event) => onNameChange(event.target.value)} disabled={!canEdit} maxLength={160} />
        </label>
        <label>
          <span>Category</span>
          <select value={item.categoryId ?? ""} onChange={(event) => onCategoryChange(event.target.value)} disabled={!canEdit}>
            <option value="">Choose category</option>
            {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select>
        </label>
        <details className="owner-menu-description">
          <summary>Description</summary>
          <label>
            <span className="setup-visually-hidden">Menu item description</span>
            <textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} disabled={!canEdit} maxLength={160} rows={3} />
            <small>This appears under the menu item. {description.length}/160</small>
          </label>
        </details>
      </div>

      <div className="owner-menu-price-field">
        <label>
          <span>Price</span>
          <div><strong>ETB</strong><input type="number" inputMode="decimal" min="0" step="0.01" value={item.price.value ?? ""} onChange={(event) => onPriceChange(event.target.value)} disabled={!canEdit} placeholder="180" /></div>
        </label>
        <strong className={priceMissing ? "owner-status needs-price" : "owner-status ready"}>{priceMissing ? "Needs Price" : "Ready"}</strong>
      </div>

      <footer>
        <button className="danger" type="button" onClick={onRemove} disabled={!canEdit}>Remove</button>
      </footer>
    </article>
  );
});
