export function ConnectionStatus({ online }: { online: boolean }) {
  return (
    <div className={`wlt-connection ${online ? "is-online" : "is-offline"}`} role="status">
      <span aria-hidden="true" /> {online ? "Online" : "Offline"}
    </div>
  );
}

export function PinIndicator({ length, size = 4 }: { length: number; size?: number }) {
  return (
    <div className="wlt-pin-indicator" aria-label={`${length} PIN digits entered`}>
      {Array.from({ length: size }, (_, index) => (
        <span key={index} className={index < length ? "is-filled" : ""} />
      ))}
    </div>
  );
}

export function PinPad({
  onDigit,
  onBackspace,
  onSubmit,
  disabled,
  submitDisabled,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  disabled: boolean;
  submitDisabled: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <div className="wlt-pin-pad" aria-label="Numeric PIN pad">
      {keys.map((key) => (
        <button type="button" key={key} onClick={() => onDigit(key)} disabled={disabled}>
          {key}
        </button>
      ))}
      <button
        type="button"
        className="is-secondary"
        onClick={onBackspace}
        disabled={disabled}
        aria-label="Delete last digit"
      >
        ←
      </button>
      <button type="button" onClick={() => onDigit("0")} disabled={disabled}>0</button>
      <button
        type="button"
        className="is-submit"
        onClick={onSubmit}
        disabled={disabled || submitDisabled}
        aria-label={disabled ? "Checking PIN" : "Log in"}
      >
        {disabled ? <span className="wlt-button-spinner" aria-hidden="true" /> : "✓"}
      </button>
    </div>
  );
}
