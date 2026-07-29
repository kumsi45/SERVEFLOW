import { memo, useState } from "react";
import { createSmartMenuLibraryDraft } from "../services/menuExtractionService";

export type SmartMenuRestaurantType =
  | "Restaurant"
  | "Hotel"
  | "Cafe"
  | "Fast Food"
  | "Bar & Lounge"
  | "Bakery";

const OPTIONS: Array<{
  type: SmartMenuRestaurantType;
  label: string;
  description: string;
}> = [
  { type: "Restaurant", label: "Restaurant", description: "Balanced all-day dining" },
  { type: "Hotel", label: "Hotel", description: "Breakfast and international dining" },
  { type: "Cafe", label: "Cafe", description: "Coffee, breakfast and light meals" },
  { type: "Fast Food", label: "Fast Food", description: "Burgers, chicken, pizza and snacks" },
  { type: "Bar & Lounge", label: "Bar & Lounge", description: "Shareable food and beverages" },
  { type: "Bakery", label: "Bakery", description: "Fresh bakery, desserts and hot drinks" },
];

type Props = {
  restaurantId: string;
  selectedType: SmartMenuRestaurantType;
  onTypeChange: (type: SmartMenuRestaurantType) => void;
  onBusyChange: (busy: boolean) => void;
  onLoaded: () => void;
};

export const SmartMenuLibraryStep = memo(function SmartMenuLibraryStep({
  restaurantId,
  selectedType,
  onTypeChange,
  onBusyChange,
  onLoaded,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedOption = OPTIONS.find((option) => option.type === selectedType) ?? OPTIONS[0];

  async function loadLibrary() {
    try {
      setBusy(true);
      onBusyChange(true);
      setError(null);
      await createSmartMenuLibraryDraft(restaurantId, selectedType);
      onLoaded();
    } catch {
      setError("We couldn't load the ServeFlow Smart Menu. Please retry.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="smart-menu-library-step">
      <div className="smart-menu-library-intro">
        <span className="smart-menu-library-mark" aria-hidden="true">SF</span>
        <div>
          <h2>Choose your restaurant type</h2>
          <p>ServeFlow will prepare a professionally curated menu draft for your restaurant type.</p>
        </div>
      </div>

      <label className="smart-menu-type-field" htmlFor="smart-menu-restaurant-type">
        <span>Restaurant type</span>
        <select
          id="smart-menu-restaurant-type"
          value={selectedType}
          onChange={(event) => onTypeChange(event.target.value as SmartMenuRestaurantType)}
        >
          {OPTIONS.map((option) => (
            <option value={option.type} key={option.type}>{option.label}</option>
          ))}
        </select>
        <small>{selectedOption.description}</small>
      </label>

      <section className="smart-menu-library-summary" aria-live="polite">
        <div>
          <span>Selected library</span>
          <strong>{selectedType}</strong>
          <small>Categories, descriptions and image references included. Add your prices in Review Studio.</small>
        </div>
        <button className="setup-primary" type="button" disabled={busy} onClick={() => void loadLibrary()}>
          {busy ? "Preparing Menu..." : "Load Smart Menu"}
        </button>
      </section>

      {error ? <div className="setup-warning" role="alert">{error}</div> : null}
    </div>
  );
});
