import { useMemo, useState } from "react";
import {
  validateStockMovementDraft,
  validateTransferDraft,
  type StockValidationContext,
} from "../services/stockOperationValidation";
import type { InventoryItem, InventoryMovementType, InventoryTransferDraft, StockMovementDraft } from "../types";

type Location = { id: string; name: string };
type Supplier = { id: string; name: string };

const numberValue = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const quantityLabel = (value: number, unit: string) => `${new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
}).format(value)} ${unit}`;

function balanceFor(context: StockValidationContext, itemId: string, storageId: string) {
  return context.currentStock
    .filter((row) => row.inventoryItemId === itemId && row.storageLocationId === storageId)
    .reduce((total, row) => total + row.currentQuantity, 0);
}

function unitFor(context: StockValidationContext, item: InventoryItem | undefined, storageId: string) {
  return context.currentStock.find((row) => row.inventoryItemId === item?.id && row.storageLocationId === storageId)?.unitName
    ?? context.units.find((unit) => unit.id === item?.unitId)?.name
    ?? "units";
}

export function StockMovementWorkspace({
  restaurantId,
  draft,
  setDraft,
  context,
  items,
  locations,
  suppliers,
  working,
  onSave,
}: {
  restaurantId: string;
  draft: StockMovementDraft;
  setDraft: (draft: StockMovementDraft) => void;
  context: StockValidationContext;
  items: InventoryItem[];
  locations: Location[];
  suppliers: Supplier[];
  working: boolean;
  onSave: () => Promise<boolean>;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const incoming = draft.movementType === "stock_in";
  const item = items.find((candidate) => candidate.id === draft.inventoryItemId);
  const location = locations.find((candidate) => candidate.id === draft.storageLocationId);
  const current = balanceFor(context, draft.inventoryItemId, draft.storageLocationId);
  const unit = unitFor(context, item, draft.storageLocationId);
  const movementQuantity = numberValue(draft.quantity);
  const after = incoming ? current + movementQuantity : current - movementQuantity;

  function update(next: StockMovementDraft) {
    setDraft(next);
    setReviewing(false);
    setValidationError(null);
  }

  function review() {
    const validation = validateStockMovementDraft(draft, context, restaurantId);
    if (!validation.valid) {
      setValidationError(validation.errors.join(" ").replace(/ingredient/g, "material"));
      return;
    }
    setValidationError(null);
    setReviewing(true);
  }

  async function confirm() {
    if (await onSave()) setReviewing(false);
  }

  if (reviewing) return <section className="ia-so-page ia-so-review" aria-labelledby="ia-so-review-title">
    <header><div><span>REVIEW</span><h2 id="ia-so-review-title">{incoming ? "Stock In" : "Stock Out"}</h2><p>Confirm this stock change before saving.</p></div></header>
    <div className="ia-so-review-card"><strong>{item?.name}</strong><span>{location?.name}</span><dl><div><dt>Current stock</dt><dd>{quantityLabel(current, unit)}</dd></div><div><dt>{incoming ? "Receiving" : "Issuing"}</dt><dd>{quantityLabel(movementQuantity, unit)}</dd></div><div><dt>{incoming ? "New stock" : "Remaining"}</dt><dd>{quantityLabel(after, unit)}</dd></div></dl>{draft.reason.trim() && <p><strong>Reason:</strong> {draft.reason}</p>}</div>
    <footer className="ia-so-review-actions"><button type="button" disabled={working} onClick={() => setReviewing(false)}>Back</button><button type="button" disabled={working} onClick={() => void confirm()}>{working ? "Saving..." : incoming ? "Confirm Stock In" : "Confirm Stock Out"}</button></footer>
  </section>;

  return <section className="ia-so-page" aria-labelledby="ia-so-title">
    <header><div><span>STOCK OPERATION</span><h2 id="ia-so-title">{incoming ? "Stock In" : "Stock Out"}</h2><p>{incoming ? "Receive material into a storage location." : "Issue material from available stock."}</p></div></header>
    {validationError && <div className="ia-so-error" id="ia-so-validation" role="alert">{validationError}</div>}
    <form className="ia-so-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
      <div className="ia-so-primary-fields">
        <label>Material<select required value={draft.inventoryItemId} onChange={(event) => update({ ...draft, inventoryItemId: event.target.value })}><option value="">Select material</option>{items.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        <label>Storage<select required value={draft.storageLocationId} onChange={(event) => update({ ...draft, storageLocationId: event.target.value })}><option value="">Select storage</option>{locations.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        <label>Quantity<input required inputMode="decimal" min="0.001" step="0.001" type="number" value={draft.quantity} aria-describedby={validationError ? "ia-so-validation" : undefined} onChange={(event) => update({ ...draft, quantity: event.target.value })} /></label>
      </div>
      {item && location && <div className={`ia-so-stock-context ${!incoming && after < 0 ? "warning" : ""}`}><span>{incoming ? "Current stock" : "Available"}</span><strong>{quantityLabel(current, unit)}</strong>{!incoming && movementQuantity > 0 && <small>Remaining after issue: {quantityLabel(after, unit)}</small>}</div>}
      <details className="ia-so-details"><summary>Additional details</summary><div>
        {incoming && <label>Supplier<select value={draft.supplierId} onChange={(event) => update({ ...draft, supplierId: event.target.value })}><option value="">No supplier selected</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>}
        <label>Reason<textarea className="ia-so-reason" rows={2} maxLength={500} placeholder="Why is this stock being changed? (optional)" value={draft.reason} onChange={(event) => update({ ...draft, reason: event.target.value })} /></label>
        <label>Movement time<input type="datetime-local" value={draft.movementDate} onChange={(event) => update({ ...draft, movementDate: event.target.value })} /></label>
      </div></details>
      <footer><button disabled={working} type="submit">Review {incoming ? "Stock In" : "Stock Out"}</button></footer>
    </form>
  </section>;
}

export function TransferWorkspace({
  restaurantId,
  draft,
  setDraft,
  context,
  items,
  locations,
  working,
  onSave,
}: {
  restaurantId: string;
  draft: InventoryTransferDraft;
  setDraft: (draft: InventoryTransferDraft) => void;
  context: StockValidationContext;
  items: InventoryItem[];
  locations: Location[];
  working: boolean;
  onSave: () => Promise<boolean>;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const item = items.find((candidate) => candidate.id === draft.inventoryItemId);
  const source = locations.find((candidate) => candidate.id === draft.fromStorageLocationId);
  const destination = locations.find((candidate) => candidate.id === draft.toStorageLocationId);
  const available = balanceFor(context, draft.inventoryItemId, draft.fromStorageLocationId);
  const unit = unitFor(context, item, draft.fromStorageLocationId);
  const quantity = numberValue(draft.quantity);
  const remaining = available - quantity;
  const destinationLocations = useMemo(() => locations.filter((location) => location.id !== draft.fromStorageLocationId), [draft.fromStorageLocationId, locations]);

  function update(next: InventoryTransferDraft) {
    setDraft(next);
    setReviewing(false);
    setValidationError(null);
  }

  function review() {
    const validation = validateTransferDraft(draft, context, restaurantId);
    if (!validation.valid) {
      setValidationError(validation.errors.join(" ").replace(/ingredient/g, "material"));
      return;
    }
    setValidationError(null);
    setReviewing(true);
  }

  async function confirm() {
    if (await onSave()) setReviewing(false);
  }

  if (reviewing) return <section className="ia-so-page ia-so-review" aria-labelledby="ia-transfer-review-title">
    <header><div><span>REVIEW</span><h2 id="ia-transfer-review-title">Transfer Stock</h2><p>Confirm both storage locations before saving.</p></div></header>
    <div className="ia-so-review-card"><strong>{item?.name}</strong><b>{quantityLabel(quantity, unit)}</b><div className="ia-so-transfer-route"><span>{source?.name}</span><i aria-hidden="true">↓</i><span>{destination?.name}</span></div><dl><div><dt>Available at source</dt><dd>{quantityLabel(available, unit)}</dd></div><div><dt>Remaining at source</dt><dd>{quantityLabel(remaining, unit)}</dd></div></dl></div>
    <footer className="ia-so-review-actions"><button type="button" disabled={working} onClick={() => setReviewing(false)}>Back</button><button type="button" disabled={working} onClick={() => void confirm()}>{working ? "Saving..." : "Confirm Transfer"}</button></footer>
  </section>;

  return <section className="ia-so-page" aria-labelledby="ia-transfer-title">
    <header><div><span>STOCK OPERATION</span><h2 id="ia-transfer-title">Transfer</h2><p>Move material between storage locations.</p></div></header>
    {validationError && <div className="ia-so-error" id="ia-transfer-validation" role="alert">{validationError}</div>}
    <form className="ia-so-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
      <div className="ia-so-primary-fields">
        <label>Material<select required value={draft.inventoryItemId} onChange={(event) => update({ ...draft, inventoryItemId: event.target.value })}><option value="">Select material</option>{items.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        <label>From storage<select required value={draft.fromStorageLocationId} onChange={(event) => update({ ...draft, fromStorageLocationId: event.target.value, toStorageLocationId: event.target.value === draft.toStorageLocationId ? "" : draft.toStorageLocationId })}><option value="">Select source</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>To storage<select required value={draft.toStorageLocationId} onChange={(event) => update({ ...draft, toStorageLocationId: event.target.value })}><option value="">Select destination</option>{destinationLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Quantity<input required inputMode="decimal" min="0.001" step="0.001" type="number" value={draft.quantity} aria-describedby={validationError ? "ia-transfer-validation" : undefined} onChange={(event) => update({ ...draft, quantity: event.target.value })} /></label>
      </div>
      {item && source && <div className={`ia-so-stock-context ${remaining < 0 ? "warning" : ""}`}><span>Available in {source.name}</span><strong>{quantityLabel(available, unit)}</strong>{quantity > 0 && <small>Remaining after transfer: {quantityLabel(remaining, unit)}</small>}</div>}
      <details className="ia-so-details"><summary>Additional details</summary><div><label>Reason<textarea className="ia-so-reason" rows={2} maxLength={500} placeholder="Why is this stock being changed? (optional)" value={draft.reason} onChange={(event) => update({ ...draft, reason: event.target.value })} /></label><label>Movement time<input type="datetime-local" value={draft.movementDate} onChange={(event) => update({ ...draft, movementDate: event.target.value })} /></label></div></details>
      <footer><button disabled={working} type="submit">Review Transfer</button></footer>
    </form>
  </section>;
}
