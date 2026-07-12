export type RealtimeConnectionState = "connecting" | "connected" | "reconnecting";

export function playNotificationTone(kind: "cashier" | "kitchen") {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = kind === "kitchen" ? "square" : "sine";
  oscillator.frequency.setValueAtTime(kind === "kitchen" ? 880 : 660, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + 0.23);
  oscillator.addEventListener("ended", () => void context.close());
}

export function realtimeStateFromStatus(status: string): RealtimeConnectionState {
  return status === "SUBSCRIBED" ? "connected" : status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "reconnecting" : "connecting";
}

