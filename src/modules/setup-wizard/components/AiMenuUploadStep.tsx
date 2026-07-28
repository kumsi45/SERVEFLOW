import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  deleteMenuImportDraft,
  listMenuImportDrafts,
  uploadMenuImportDraft,
  type MenuImportDraft,
} from "../services/menuImportDraftService";
import {
  formatMenuImportFileSize,
  getMenuImportMaxFileBytes,
  MENU_IMPORT_ACCEPT,
  validateMenuImportFile,
} from "../services/menuImportFileValidation";
import { createStarterMenuReviewDraft } from "../services/menuExtractionService";

type AiMenuUploadStepProps = {
  restaurantId: string;
  onDraftCountChange: (count: number) => void;
  onBusyChange: (busy: boolean) => void;
  showStarterMenuOption?: boolean;
  restaurantType?: string;
  onStarterCreated?: () => void;
};

const maxFileBytes = getMenuImportMaxFileBytes(
  import.meta.env.VITE_MENU_IMPORT_MAX_FILE_MB,
);

export const AiMenuUploadStep = memo(function AiMenuUploadStep({
  restaurantId,
  onDraftCountChange,
  onBusyChange,
  showStarterMenuOption = false,
  restaurantType = "Restaurant",
  onStarterCreated,
}: AiMenuUploadStepProps) {
  const browseRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<MenuImportDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listMenuImportDrafts(restaurantId)
      .then((loadedDrafts) => {
        if (active) setDrafts(loadedDrafts);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setWarnings([
            loadError instanceof Error
              ? loadError.message
              : "Import drafts could not be loaded.",
          ]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [restaurantId]);

  useEffect(() => {
    onDraftCountChange(drafts.length);
  }, [drafts.length, onDraftCountChange]);

  useEffect(() => {
    onBusyChange(busyDraftId !== null);
  }, [busyDraftId, onBusyChange]);

  useEffect(
    () => () => {
      onBusyChange(false);
    },
    [onBusyChange],
  );

  const processFiles = useCallback(
    async (files: File[], existing?: MenuImportDraft) => {
      const selectedFiles = existing ? files.slice(0, 1) : files;
      const validationWarnings: string[] = [];
      const validFiles = selectedFiles.filter((file) => {
        const warning = validateMenuImportFile(file, maxFileBytes);
        if (warning) validationWarnings.push(warning);
        return !warning;
      });
      setWarnings(validationWarnings);

      for (const [index, file] of validFiles.entries()) {
        const progressId =
          existing?.id ?? `upload-${Date.now()}-${index}-${file.name}`;
        setBusyDraftId(progressId);
        setProgress((current) => ({ ...current, [progressId]: 0 }));
        try {
          const savedDraft = await uploadMenuImportDraft(
            restaurantId,
            file,
            (percentage) =>
              setProgress((current) => ({
                ...current,
                [progressId]: percentage,
              })),
            existing,
          );
          setDrafts((current) => {
            const withoutPrevious = current.filter(
              (draft) => draft.id !== savedDraft.id,
            );
            return [...withoutPrevious, savedDraft].sort((first, second) =>
              first.createdAt.localeCompare(second.createdAt),
            );
          });
        } catch (uploadError) {
          setWarnings((current) => [
            ...current,
            uploadError instanceof Error
              ? `${file.name}: ${uploadError.message}`
              : `${file.name}: Upload failed.`,
          ]);
        } finally {
          setBusyDraftId(null);
          setProgress((current) => {
            const next = { ...current };
            delete next[progressId];
            return next;
          });
        }
      }
    },
    [restaurantId],
  );

  function handleBrowse(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) void processFiles(files);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (busyDraftId) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void processFiles(files);
  }

  async function removeDraft(draft: MenuImportDraft) {
    if (
      !window.confirm(
        `Delete ${draft.fileName} from your import drafts?`,
      )
    ) {
      return;
    }
    try {
      setBusyDraftId(draft.id);
      setWarnings([]);
      await deleteMenuImportDraft(draft);
      setDrafts((current) =>
        current.filter((candidate) => candidate.id !== draft.id),
      );
    } catch (deleteError) {
      setWarnings([
        deleteError instanceof Error
          ? deleteError.message
          : "The import draft could not be deleted.",
      ]);
    } finally {
      setBusyDraftId(null);
    }
  }

  async function createStarterMenu() {
    try {
      setBusyDraftId("starter-menu");
      setWarnings([]);
      await createStarterMenuReviewDraft(restaurantId, restaurantType);
      onStarterCreated?.();
    } catch {
      setWarnings(["We couldn't create your starter menu right now. Please retry or upload a menu."]);
    } finally {
      setBusyDraftId(null);
    }
  }

  return (
    <div className="setup-import-builder setup-import-hero">
      <div
        className={`setup-import-dropzone${dragActive ? " dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragActive(false);
          }
        }}
        onDrop={handleDrop}
      >
        <span className="setup-import-icon" aria-hidden="true">↑</span>
        <strong>Upload Menu</strong>
        <span>Take a photo or choose a menu from your device</span>
        <span>PDF, PNG, JPG, JPEG, WEBP, or DOCX</span>
        <span>Maximum {formatMenuImportFileSize(maxFileBytes)} per file</span>
        <button
          className="setup-primary"
          type="button"
          onClick={() => browseRef.current?.click()}
          disabled={busyDraftId !== null}
        >
          Choose Menu
        </button>
        <input
          ref={browseRef}
          className="setup-visually-hidden"
          type="file"
          accept={MENU_IMPORT_ACCEPT}
          multiple
          onChange={handleBrowse}
          aria-label="Choose menu files to upload"
          disabled={busyDraftId !== null}
        />
      </div>

      {showStarterMenuOption ? (
        <div className="setup-starter-option">
          <span aria-hidden="true">✦</span>
          <div><strong>Start With Smart Starter Menu</strong><p>Choose a professionally prepared menu for your restaurant type, then edit it in Review Studio.</p></div>
          <button type="button" className="setup-secondary" disabled={busyDraftId !== null} onClick={() => void createStarterMenu()}>{busyDraftId === "starter-menu" ? "Creating..." : "Choose starter"}</button>
          <small>Your starter opens as a private draft. Nothing is published until you approve it.</small>
        </div>
      ) : null}

      <div className="setup-import-warnings" aria-live="polite">
        {warnings.map((warning, index) => (
          <div className="setup-warning" role="alert" key={`${warning}-${index}`}>
            {warning}
          </div>
        ))}
      </div>

      {Object.entries(progress).map(([progressId, percentage]) => (
        <div className="setup-upload-progress" key={progressId}>
          <span>Uploading draft</span>
          <strong>{percentage}%</strong>
          <div
            role="progressbar"
            aria-label="Menu file upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage}
          >
            <span style={{ width: `${percentage}%` }} />
          </div>
        </div>
      ))}

      <section className="setup-import-list" aria-labelledby="import-drafts-title">
        <div className="setup-import-list-heading">
          <div>
            <h3 id="import-drafts-title">Uploaded drafts</h3>
            <p>{drafts.length} file{drafts.length === 1 ? "" : "s"} stored privately</p>
          </div>
        </div>

        {loading ? (
          <p className="setup-import-empty">Loading import drafts...</p>
        ) : drafts.length === 0 ? (
          <p className="setup-import-empty">
            No menu uploaded yet. You can continue and return at any time.
          </p>
        ) : (
          <div className="setup-import-files">
            {drafts.map((draft) => (
              <article className="setup-import-file" key={draft.id}>
                <div className="setup-import-thumbnail">
                  {draft.mimeType.startsWith("image/") && draft.previewUrl ? (
                    <img src={draft.previewUrl} alt="" />
                  ) : (
                    <span aria-hidden="true">
                      {draft.fileName.split(".").pop()?.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="setup-import-file-copy">
                  <strong title={draft.fileName}>{draft.fileName}</strong>
                  <span>
                    {formatMenuImportFileSize(draft.fileSize)} / Import draft
                  </span>
                </div>
                <div className="setup-import-file-actions">
                  {draft.previewUrl ? (
                    <a
                      className="setup-secondary"
                      href={draft.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Preview ${draft.fileName}`}
                    >
                      Preview
                    </a>
                  ) : null}
                  <label className="setup-secondary">
                    Replace
                    <input
                      className="setup-visually-hidden"
                      type="file"
                      accept={MENU_IMPORT_ACCEPT}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void processFiles([file], draft);
                      }}
                      disabled={busyDraftId !== null}
                      aria-label={`Replace ${draft.fileName}`}
                    />
                  </label>
                  <button
                    className="setup-import-delete"
                    type="button"
                    onClick={() => void removeDraft(draft)}
                    disabled={busyDraftId !== null}
                    aria-label={`Delete ${draft.fileName}`}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
});
