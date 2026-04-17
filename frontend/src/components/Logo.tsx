import { t } from "../lib/i18n";

interface Props {
  size?: number;
  withLabel?: boolean;
  className?: string;
}

/** PageMentor mark: a stack of three books in red tones. */
export function Logo({ size = 22, withLabel = true, className }: Props) {
  return (
    <div className={"flex items-center gap-2 " + (className ?? "")}>
      <span
        className="inline-flex flex-shrink-0"
        style={{
          // drop-shadow on the wrapper, not the svg — svg viewBox would
          // clip the halo otherwise.
          filter:
            "drop-shadow(0 0 4px rgba(239, 68, 68, 0.75)) " +
            "drop-shadow(0 0 10px rgba(239, 68, 68, 0.45)) " +
            "drop-shadow(0 0 20px rgba(239, 68, 68, 0.25))",
        }}
      >
        <BookStackIcon size={size} />
      </span>
      {withLabel && (
        <span className="font-semibold tracking-tight">{t("app.name")}</span>
      )}
    </div>
  );
}

function BookStackIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ overflow: "visible" }}
    >
      {/* Three stacked book covers, sizes stepped down, no rotation,
          colours deliberately unsorted. The two dark slits on each
          cover hint at a spine binding. */}

      {/* Bottom — medium red */}
      <rect x="2.5" y="15.5" width="19" height="5" rx="0.8" fill="#dc2626" />
      <rect x="4.5" y="16.6" width="0.7" height="2.8" fill="rgba(0,0,0,0.35)" />
      <rect x="6" y="16.6" width="0.5" height="2.8" fill="rgba(0,0,0,0.35)" />

      {/* Middle — accent */}
      <rect x="3.5" y="9.5" width="17" height="5" rx="0.8" fill="#ef4444" />
      <rect x="5.5" y="10.6" width="0.7" height="2.8" fill="rgba(0,0,0,0.35)" />
      <rect x="7" y="10.6" width="0.5" height="2.8" fill="rgba(0,0,0,0.35)" />

      {/* Top — slightly brightened dark red */}
      <rect x="4.5" y="3.5" width="15" height="5" rx="0.8" fill="#991b1b" />
      <rect x="6.5" y="4.6" width="0.7" height="2.8" fill="rgba(0,0,0,0.35)" />
      <rect x="8" y="4.6" width="0.5" height="2.8" fill="rgba(0,0,0,0.35)" />

      {/* Top highlight */}
      <rect
        x="5.2"
        y="3.7"
        width="14"
        height="0.6"
        rx="0.3"
        fill="rgba(255,255,255,0.15)"
      />
    </svg>
  );
}
