import { memo, useState } from "react";
import { createSmartMenuLibraryDraft } from "../services/menuExtractionService";

export type SmartMenuRestaurantType =
  | "Restaurant"
  | "Hotel"
  | "Cafe"
  | "Fast Food"
  | "Bar & Lounge"
  | "Bakery";

export type SmartMenuBusinessType = "Restaurant" | "Cafe" | "Hotel" | "Fast Food" | "Bar" | "Lounge";

export function libraryTypeForBusiness(type: SmartMenuBusinessType): SmartMenuRestaurantType {
  return type === "Bar" || type === "Lounge" ? "Bar & Lounge" : type;
}

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
  selectedType: SmartMenuBusinessType;
  onBusyChange: (busy: boolean) => void;
  onLoaded: () => void;
};

export const SmartMenuLibraryStep = memo(function SmartMenuLibraryStep({
  restaurantId,
  selectedType,
  onBusyChange,
  onLoaded,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const libraryType = libraryTypeForBusiness(selectedType);
  const selectedOption = OPTIONS.find((option) => option.type === libraryType) ?? OPTIONS[0];

  async function loadLibrary() {
    try {
      setBusy(true);
      onBusyChange(true);
      setError(null);
      await createSmartMenuLibraryDraft(restaurantId, libraryType);
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
          <h2>Choose Your Smart Menu Library</h2>
          <p>A professionally curated starting point, selected for your business and ready to personalize.</p>
        </div>
      </div>

      <dl className="smart-menu-library-details">
        <div><dt>Business Type</dt><dd>{selectedType}</dd></div>
        <div><dt>Selected Library</dt><dd>{selectedOption.label}</dd></div>
      </dl>

      <section className="smart-menu-library-summary" aria-live="polite">
        <div>
          <span>Selected library</span>
          <strong>{selectedOption.label} Essentials</strong>
          <small>{selectedOption.description}. A polished foundation you can edit before publishing.</small>
          <ul aria-label="Included with this library"><li>Categories</li><li>Menu Items</li><li>AI Food Photography</li><li>Smart Descriptions</li><li>Smart Organization</li></ul>
        </div>
        <button className="setup-primary" type="button" disabled={busy} onClick={() => void loadLibrary()}>
          {busy ? "Preparing Menu..." : "Load Smart Menu"}
        </button>
      </section>

      {error ? <div className="setup-warning" role="alert">{error}</div> : null}
    </div>
  );
});
