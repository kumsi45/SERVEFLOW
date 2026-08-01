import { useState } from "react";
import { SfButton, SfCard, SfCardHeader, SfIcon, SfSidePanel } from "../design-system";
import "./ownerAiAdvisor.css";

const suggestedPrompts = [
  "How is revenue today?",
  "Which menu items need attention?",
  "Summarize kitchen performance",
  "Show inventory risks",
];

const businessCards = [
  { icon: "↗", label: "Revenue", detail: "Sales and payment trends" },
  { icon: "□", label: "Orders", detail: "Volume and fulfilment" },
  { icon: "◷", label: "Kitchen", detail: "Queue and preparation" },
  { icon: "!", label: "Inventory", detail: "Stock and availability" },
];

type OwnerAiAdvisorProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  businessName: string;
};

export function OwnerAiAdvisor({ open, onOpen, onClose, businessName }: OwnerAiAdvisorProps) {
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);

  return <>
    <button type="button" className="sf-ai-launcher" aria-label="Open AI Business Advisor" aria-expanded={open} onClick={onOpen}>
      <span className="sf-ai-launcher-mark">AI</span><span>Business Advisor</span>
    </button>
    <SfSidePanel open={open} onClose={onClose} eyebrow="ServeFlow intelligence" title="Business Advisor" className="sf-ai-panel">
      <div className="sf-ai-conversation" aria-live="polite">
        <div className="sf-ai-message assistant"><span className="sf-ai-avatar">AI</span><div><strong>Good to see you.</strong><p>I can help you understand {businessName || "your business"}. This preview is presentation-only; live AI will be connected in a future release.</p></div></div>
        {selectedPrompt ? <div className="sf-ai-message owner"><div><strong>You</strong><p>{selectedPrompt}</p></div></div> : null}
      </div>

      <section className="sf-ai-section" aria-labelledby="sf-ai-context-title">
        <header><span>Business context</span><h3 id="sf-ai-context-title">What your advisor can explore</h3></header>
        <div className="sf-ai-business-grid">{businessCards.map((card) => <SfCard key={card.label} className="sf-ai-business-card"><SfIcon>{card.icon}</SfIcon><div><strong>{card.label}</strong><small>{card.detail}</small></div></SfCard>)}</div>
      </section>

      <section className="sf-ai-section" aria-labelledby="sf-ai-prompts-title">
        <SfCardHeader eyebrow="Start a conversation" title="Suggested prompts" />
        <div className="sf-ai-prompts" id="sf-ai-prompts-title">{suggestedPrompts.map((prompt) => <SfButton key={prompt} variant="secondary" onClick={() => setSelectedPrompt(prompt)}>{prompt}<span aria-hidden="true">→</span></SfButton>)}</div>
      </section>

      <form className="sf-ai-composer" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="sf-ai-message">Ask Business Advisor</label>
        <div><input id="sf-ai-message" placeholder="Ask about your business…" disabled aria-describedby="sf-ai-coming-soon" /><SfButton type="submit" disabled aria-label="Send message">↑</SfButton></div>
        <small id="sf-ai-coming-soon">AI responses are coming soon.</small>
      </form>
    </SfSidePanel>
  </>;
}
