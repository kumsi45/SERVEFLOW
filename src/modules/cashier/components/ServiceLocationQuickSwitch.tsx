import {
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react";
import { CashierIcon } from "./CashierDashboardUi";

export type ServiceLocationStatus =
  | "available"
  | "occupied"
  | "payment-due"
  | "bill-requested"
  | "receipt-pending";

export type ServiceLocationCardModel = {
  id: string;
  key: string;
  tableNumber: number;
  name: string;
  status: ServiceLocationStatus;
  supportingText?: string | null;
};

const STATUS_LABELS: Record<ServiceLocationStatus, string> = {
  available: "Available",
  occupied: "Occupied",
  "payment-due": "Payment due",
  "bill-requested": "Bill requested",
  "receipt-pending": "Receipt pending",
};

const COMPACT_STATUS_LABELS: Record<ServiceLocationStatus, string> = {
  available: "Free",
  occupied: "Busy",
  "payment-due": "Due",
  "bill-requested": "Bill",
  "receipt-pending": "Receipt",
};

const SERVICE_LOCATION_COLUMNS = 6;

export function resolveServiceLocationPanelTitle(
  configuredLabel?: string | null,
) {
  return configuredLabel?.trim() || "Service Locations";
}

export function formatServiceLocationName({
  label,
  tableNumber,
}: {
  label?: string | null;
  tableNumber: string | number;
}) {
  const configuredLabel = label?.trim();
  if (configuredLabel && !/^id(?:\s|[-:#]|$)/i.test(configuredLabel)) {
    return /^\d+$/.test(configuredLabel)
      ? `Service Location ${configuredLabel}`
      : configuredLabel;
  }
  return `Service Location ${tableNumber}`;
}

export function serviceLocationStatusLabel(status: ServiceLocationStatus) {
  return STATUS_LABELS[status];
}

export function serviceLocationTableLabel(tableNumber: string | number) {
  return `Table ${tableNumber}`;
}

export function ServiceLocationQuickSwitch({
  title,
  locations,
  selectedKey,
  loading,
  onSelect,
}: {
  title?: string | null;
  locations: ServiceLocationCardModel[];
  selectedKey: string;
  loading: boolean;
  onSelect: (location: ServiceLocationCardModel) => void;
}) {
  const panelTitle = resolveServiceLocationPanelTitle(title);
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!selectedKey) return;
    const selectedTile = tileRefs.current.get(selectedKey);
    selectedTile?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey]);

  function handleLocationKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const navigationKeys = [
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "Home",
      "End",
    ];
    if (!navigationKeys.includes(event.key)) return;

    const tiles = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>(
        ".cd-location-tile:not([disabled])",
      ) ?? [],
    );
    if (tiles.length === 0) return;

    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tiles.length - 1
        : event.key === "ArrowUp"
          ? (index - SERVICE_LOCATION_COLUMNS + tiles.length) % tiles.length
          : event.key === "ArrowDown"
            ? (index + SERVICE_LOCATION_COLUMNS) % tiles.length
            : event.key === "ArrowLeft"
              ? (index - 1 + tiles.length) % tiles.length
              : (index + 1) % tiles.length;
    tiles[nextIndex]?.focus();
  }

  return (
    <section
      className="cd-location-switch"
      aria-label={panelTitle}
    >
      {loading ? (
        <div className="cd-location-grid cd-location-loading" aria-label="Loading service locations" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span className="cd-location-skeleton" key={index} />
          ))}
        </div>
      ) : locations.length === 0 ? (
        <div className="cd-location-empty" role="status">
          <strong>No service locations configured</strong>
          <span>Add tables, rooms, counters, or service areas from business settings.</span>
        </div>
      ) : (
        <div
          ref={gridRef}
          className="cd-location-grid"
          role="listbox"
          aria-label={panelTitle}
          aria-activedescendant={selectedKey ? `cashier-location-${selectedKey}` : undefined}
        >
          {locations.map((location, index) => {
            const selected = selectedKey === location.key;
            const statusLabel = serviceLocationStatusLabel(location.status);
            const accessibleLabel = [
              location.name,
              statusLabel,
              selected ? "selected" : null,
              location.supportingText,
            ].filter(Boolean).join(", ");

            return (
              <button
                id={`cashier-location-${location.key}`}
                type="button"
                role="option"
                key={location.id}
                ref={(node) => {
                  if (node) tileRefs.current.set(location.key, node);
                  else tileRefs.current.delete(location.key);
                }}
                className={`cd-location-tile ${location.status}${selected ? " selected" : ""}`}
                aria-selected={selected}
                aria-label={accessibleLabel}
                onClick={() => onSelect(location)}
                onKeyDown={(event) => handleLocationKeyDown(event, index)}
              >
                <strong title={location.name}>
                  {serviceLocationTableLabel(location.tableNumber)}
                </strong>
                <span className="cd-location-status">
                  <i aria-hidden="true" />
                  <span>{COMPACT_STATUS_LABELS[location.status]}</span>
                </span>
                {location.supportingText ? (
                  <small title={location.supportingText}>{location.supportingText}</small>
                ) : null}
                {selected ? (
                  <span className="cd-location-selected-icon" aria-hidden="true">
                    <CashierIcon name="paid" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
