import type { ReactNode } from "react";
import { BackIcon } from "@/components/manufacturer/icons";

/** Segmented progress bar shared by the Epic 2 and Epic 3 wizards. */
export function WizardProgress({ total, step }: { total: number; step: number }) {
  return (
    <div className="wiz-progress-track">
      {Array.from({ length: total }, (_, index) => {
        const segment = index + 1;
        const className =
          segment < step ? "wiz-seg filled" : segment === step ? "wiz-seg active" : "wiz-seg";
        return <div className={className} key={segment} />;
      })}
    </div>
  );
}

type WizardFooterProps = {
  onPrevious?: () => void;
  onSkip: () => void;
  onNext: () => void;
  nextLabel?: string;
  /** When false, Previous is omitted (no broken back navigation). */
  showPrevious?: boolean;
  /** True while the current step is being saved: buttons are disabled (no double submit). */
  busy?: boolean;
};

/** Shared footer: Previous (left) · Skip (center) · Save & Next (right). */
export function WizardFooter({
  onPrevious,
  onSkip,
  onNext,
  nextLabel = "Save & Next",
  showPrevious = true,
  busy = false,
}: WizardFooterProps) {
  return (
    <div className="wiz-footer">
      <div className="wiz-footer-side wiz-footer-left">
        {showPrevious && onPrevious ? (
          <button type="button" className="btn-primary" onClick={onPrevious} disabled={busy}>
            Previous
          </button>
        ) : null}
      </div>
      <button type="button" className="btn-text wiz-footer-skip" onClick={onSkip} disabled={busy}>
        Skip
      </button>
      <div className="wiz-footer-side wiz-footer-right">
        <button type="button" className="btn-primary" onClick={onNext} disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : nextLabel}
        </button>
      </div>
    </div>
  );
}

type WizardShellProps = {
  title: string;
  badge?: string;
  stepLabel: string;
  progressPct: string;
  total: number;
  step: number;
  /** When omitted, the top circular back icon is hidden. */
  onBack?: () => void;
  footer: ReactNode;
  children: ReactNode;
};

export function WizardShell({
  title,
  badge,
  stepLabel,
  progressPct,
  total,
  step,
  onBack,
  footer,
  children,
}: WizardShellProps) {
  return (
    <div className="wiz-overlay">
      <div className="wiz-header">
        <span className="wiz-header-title">{title}</span>
        {badge ? <span className="pct-badge">{badge}</span> : null}
      </div>
      <div className="wiz-main">
        {onBack ? (
          <button
            type="button"
            className="icon-btn"
            title="Back"
            aria-label="Back"
            onClick={onBack}
            style={{ marginBottom: 16 }}
          >
            <BackIcon size={16} />
          </button>
        ) : null}
        <p className="wiz-step-label">{stepLabel}</p>
        <div className="wiz-progress-row">
          <WizardProgress total={total} step={step} />
          <span className="wiz-pct">{progressPct}</span>
        </div>
        <div className="wiz-card">{children}</div>
      </div>
      {footer}
    </div>
  );
}
