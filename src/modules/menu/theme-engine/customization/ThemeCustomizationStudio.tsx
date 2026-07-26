import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useModalFocus } from "../../../../core/accessibility/useModalFocus";
import { supabase } from "../../../../core/database";
import { publishMenuThemeSelection } from "../themeEvents";
import { themeRegistry } from "../ThemeRegistry";
import {
  isMenuTheme,
  resolveMenuTheme,
  type MenuTheme,
} from "../ThemeTypes";
import { ThemeCustomizationPanel } from "./ThemeCustomizationPanel";
import { ThemeLivePreview } from "./ThemeLivePreview";
import {
  createStoredThemeCustomization,
  normalizeThemeCustomization,
  publishThemeCustomizationSelection,
  readThemeCustomization,
  themeCustomizationDraftKey,
  type ThemeCustomization,
} from "./themeCustomization";
import "./themeCustomizationStudio.css";

type ThemeStudioRole = "owner" | "manager";

type ThemeCustomizationStudioProps = {
  restaurantId: string;
  role: ThemeStudioRole;
  onPublished?: () => void | Promise<void>;
};

type RestaurantStudioRow = {
  id: string;
  name: string;
  slug: string;
  total_tables?: number | null;
  table_count?: number | null;
  ordering_settings?: Record<string, unknown> | null;
  menu_theme?: MenuTheme | null;
};

type DraftPayload = {
  theme: MenuTheme;
  customization: ThemeCustomization;
};

type ResetAction = "theme" | "defaults" | null;

function parseDraft(value: string | null): DraftPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      theme?: unknown;
      customization?: unknown;
    };
    if (!isMenuTheme(parsed.theme)) return null;
    return {
      theme: parsed.theme,
      customization: normalizeThemeCustomization(parsed.customization),
    };
  } catch {
    return null;
  }
}

function ThemeThumbnail({ theme }: { theme: MenuTheme }) {
  return (
    <div
      className={`tcs-theme-thumbnail ${theme}`}
      role="img"
      aria-label={`${themeRegistry[theme].name} theme preview`}
    >
      <span className="tcs-thumb-hero" />
      <span className="tcs-thumb-pill" />
      <span className="tcs-thumb-card first" />
      <span className="tcs-thumb-card second" />
    </div>
  );
}

export const ThemeCustomizationStudio = memo(
  function ThemeCustomizationStudio({
    restaurantId,
    role,
    onPublished,
  }: ThemeCustomizationStudioProps) {
    const [restaurant, setRestaurant] =
      useState<RestaurantStudioRow | null>(null);
    const [publishedTheme, setPublishedTheme] =
      useState<MenuTheme>("modern");
    const [selectedTheme, setSelectedTheme] =
      useState<MenuTheme>("modern");
    const [publishedCustomization, setPublishedCustomization] =
      useState<ThemeCustomization>({});
    const [customization, setCustomization] =
      useState<ThemeCustomization>({});
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [resetAction, setResetAction] = useState<ResetAction>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const resetDialogRef = useRef<HTMLElement>(null);
    const resetCancelRef = useRef<HTMLButtonElement>(null);

    useModalFocus(
      resetAction !== null,
      () => setResetAction(null),
      resetDialogRef,
      resetCancelRef,
    );

    const loadStudio = useCallback(async () => {
      setLoading(true);
      setError(null);
      const { data, error: loadError } = await supabase
        .from("restaurants")
        .select(
          "id,name,slug,total_tables,table_count,ordering_settings,menu_theme",
        )
        .eq("id", restaurantId)
        .limit(1)
        .maybeSingle();

      if (loadError) throw new Error(loadError.message);
      if (!data?.id || !data.name || !data.slug) {
        throw new Error("Restaurant theme settings are unavailable.");
      }

      const row = data as RestaurantStudioRow;
      const theme = resolveMenuTheme(row.menu_theme);
      const published = readThemeCustomization(row.ordering_settings);
      const draft =
        typeof window === "undefined"
          ? null
          : parseDraft(
              window.localStorage.getItem(
                themeCustomizationDraftKey(restaurantId),
              ),
            );

      setRestaurant(row);
      setPublishedTheme(theme);
      setPublishedCustomization(published);
      setSelectedTheme(draft?.theme ?? theme);
      setCustomization(draft?.customization ?? published);
      if (draft) setNotice("Local draft restored.");
      setLoading(false);
    }, [restaurantId]);

    useEffect(() => {
      let mounted = true;
      void loadStudio().catch((loadError) => {
        if (!mounted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Theme Studio could not be loaded.",
        );
        setLoading(false);
      });
      return () => {
        mounted = false;
      };
    }, [loadStudio]);

    const definitions = useMemo(
      () => Object.values(themeRegistry),
      [],
    );
    const dirty = useMemo(
      () =>
        selectedTheme !== publishedTheme ||
        JSON.stringify(customization) !==
          JSON.stringify(publishedCustomization),
      [
        customization,
        publishedCustomization,
        publishedTheme,
        selectedTheme,
      ],
    );

    function saveDraft() {
      try {
        window.localStorage.setItem(
          themeCustomizationDraftKey(restaurantId),
          JSON.stringify({
            theme: selectedTheme,
            customization,
          } satisfies DraftPayload),
        );
        setError(null);
        setNotice("Draft saved on this device.");
      } catch {
        setError("This browser could not save the theme draft.");
      }
    }

    function discardChanges() {
      setSelectedTheme(publishedTheme);
      setCustomization(publishedCustomization);
      window.localStorage.removeItem(themeCustomizationDraftKey(restaurantId));
      setError(null);
      setNotice("Unpublished changes discarded.");
    }

    async function publish() {
      if (!restaurant || role !== "owner") return;
      try {
        setWorking(true);
        setError(null);
        setNotice(null);
        const storedCustomization =
          createStoredThemeCustomization(customization);
        const { error: settingsError } = await supabase.rpc(
          "update_restaurant_configuration",
          {
            target_restaurant_id: restaurantId,
            restaurant_name: restaurant.name,
            requested_total_tables:
              restaurant.total_tables ?? restaurant.table_count ?? 20,
            profile_payload: {},
            business_hours_payload: {},
            kitchen_settings_payload: {},
            ordering_settings_payload: {
              theme_customization: storedCustomization,
            },
            branding_payload: {},
            notification_settings_payload: {},
            security_settings_payload: {},
          },
        );
        if (settingsError) throw new Error(settingsError.message);

        const { error: themeError } = await supabase
          .from("restaurants")
          .update({ menu_theme: selectedTheme })
          .eq("id", restaurantId);
        if (themeError) throw new Error(themeError.message);

        const normalized = normalizeThemeCustomization(customization);
        setPublishedTheme(selectedTheme);
        setPublishedCustomization(normalized);
        setCustomization(normalized);
        setRestaurant((current) =>
          current
            ? {
                ...current,
                menu_theme: selectedTheme,
                ordering_settings: {
                  ...(current.ordering_settings ?? {}),
                  theme_customization: storedCustomization,
                },
              }
            : current,
        );
        window.localStorage.removeItem(
          themeCustomizationDraftKey(restaurantId),
        );
        publishMenuThemeSelection(restaurantId, selectedTheme);
        publishThemeCustomizationSelection(
          restaurantId,
          selectedTheme,
          normalized,
        );
        await onPublished?.();
        setNotice("Theme published to the live QR menu.");
      } catch (publishError) {
        setError(
          publishError instanceof Error
            ? publishError.message
            : "Theme could not be published.",
        );
      } finally {
        setWorking(false);
      }
    }

    function confirmReset() {
      if (resetAction === "theme") {
        setSelectedTheme("modern");
        setCustomization({});
        setNotice("Theme reset prepared. Publish to make it live.");
      } else if (resetAction === "defaults") {
        setCustomization({});
        setNotice("Theme defaults restored in preview.");
      }
      setResetAction(null);
    }

    function focusPreview() {
      previewRef.current?.focus();
      previewRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    if (loading) {
      return (
        <section className="theme-customization-studio loading" role="status">
          <div className="tcs-loading-mark" aria-hidden="true" />
          <h2>Opening Theme Studio</h2>
          <p>Preparing themes and restaurant branding.</p>
        </section>
      );
    }

    if (!restaurant) {
      return (
        <section className="theme-customization-studio error" role="alert">
          <h2>Theme Studio unavailable</h2>
          <p>{error || "Restaurant theme settings could not be loaded."}</p>
          <button type="button" onClick={() => void loadStudio()}>
            Try Again
          </button>
        </section>
      );
    }

    return (
      <section
        className="theme-customization-studio"
        aria-labelledby="theme-studio-title"
      >
        <header className="tcs-studio-header">
          <div>
            <span>Restaurant appearance</span>
            <h2 id="theme-studio-title">Theme Customization Studio</h2>
            <p>
              Personalize {restaurant.name} without changing menu or ordering
              behavior.
            </p>
          </div>
          <div className="tcs-studio-status">
            <span className={dirty ? "draft" : "published"}>
              {dirty ? "Unpublished changes" : "Published"}
            </span>
            <strong>{themeRegistry[selectedTheme].name}</strong>
          </div>
        </header>

        {(error || notice) && (
          <div
            className={error ? "tcs-notice error" : "tcs-notice success"}
            role={error ? "alert" : "status"}
          >
            {error || notice}
          </div>
        )}

        {role === "manager" && (
          <div className="tcs-manager-note" role="note">
            Managers can prepare and save previews. Publishing remains
            owner-approved under the restaurant’s existing settings
            permissions.
          </div>
        )}

        <section className="tcs-theme-selection" aria-labelledby="themes-title">
          <div className="tcs-section-heading">
            <div>
              <span>Section 1</span>
              <h3 id="themes-title">Choose a Theme</h3>
            </div>
            <p>All four ServeFlow production themes support customization.</p>
          </div>
          <div className="tcs-theme-grid">
            {definitions.map((definition) => {
              const active = publishedTheme === definition.id;
              const selected = selectedTheme === definition.id;
              return (
                <article
                  className={`tcs-theme-choice${selected ? " selected" : ""}`}
                  key={definition.id}
                >
                  <ThemeThumbnail theme={definition.id} />
                  <div className="tcs-theme-choice-copy">
                    <div>
                      <h4>{definition.name}</h4>
                      {active && <span>Active</span>}
                    </div>
                    <p>{definition.preview}</p>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedTheme(definition.id)}
                    >
                      {selected ? "Selected" : "Select Theme"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="tcs-editor-layout">
          <ThemeCustomizationPanel
            theme={selectedTheme}
            customization={customization}
            disabled={working}
            onChange={setCustomization}
          />
          <div
            className="tcs-preview-column"
            ref={previewRef}
            tabIndex={-1}
          >
            <div className="tcs-preview-heading">
              <div>
                <span>Live Preview</span>
                <h3>{themeRegistry[selectedTheme].name}</h3>
              </div>
              <small>Updates instantly</small>
            </div>
            <ThemeLivePreview
              restaurantSlug={restaurant.slug}
              theme={selectedTheme}
              customization={customization}
            />
          </div>
        </div>

        <footer className="tcs-studio-actions">
          <div className="tcs-reset-actions">
            <button
              type="button"
              onClick={() => setResetAction("theme")}
              disabled={working}
            >
              Reset Theme
            </button>
            <button
              type="button"
              onClick={() => setResetAction("defaults")}
              disabled={working}
            >
              Restore Defaults
            </button>
          </div>
          <div className="tcs-publish-actions">
            <button type="button" onClick={focusPreview} disabled={working}>
              Preview
            </button>
            <button
              type="button"
              onClick={discardChanges}
              disabled={working || !dirty}
            >
              Discard
            </button>
            <button type="button" onClick={saveDraft} disabled={working}>
              Save Draft
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => void publish()}
              disabled={working || !dirty || role !== "owner"}
              title={
                role === "manager"
                  ? "An owner must publish theme changes."
                  : undefined
              }
            >
              {working ? "Publishing..." : "Publish"}
            </button>
          </div>
        </footer>

        {resetAction && (
          <div className="tcs-dialog-layer" role="presentation">
            <button
              className="tcs-dialog-backdrop"
              type="button"
              aria-label="Cancel reset"
              onClick={() => setResetAction(null)}
            />
            <section
              ref={resetDialogRef}
              className="tcs-confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="theme-reset-title"
              aria-describedby="theme-reset-description"
              tabIndex={-1}
            >
              <span aria-hidden="true">!</span>
              <h3 id="theme-reset-title">
                {resetAction === "theme"
                  ? "Reset the theme?"
                  : "Restore theme defaults?"}
              </h3>
              <p id="theme-reset-description">
                {resetAction === "theme"
                  ? "This prepares Modern with no custom overrides. The live menu changes only after publishing."
                  : "This clears visual overrides for the selected theme. The live menu changes only after publishing."}
              </p>
              <div>
                <button
                  ref={resetCancelRef}
                  type="button"
                  onClick={() => setResetAction(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={confirmReset}
                >
                  Confirm Reset
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    );
  },
);
