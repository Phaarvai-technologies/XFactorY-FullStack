"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";

type PlatformStats = {
  manufacturerCount: number;
  machineryCount: number;
  manufacturerDeltaThisMonth?: number;
  machineryDeltaThisMonth?: number;
  availabilityOverTime: {
    date: string;
    availableUnits: number;
  }[];
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1";

async function fetchPlatformStats(): Promise<PlatformStats> {
  const res = await fetch(`${API_URL}/metrics/platform`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to load platform stats: ${res.status}`);
  }

  return res.json();
}

/**
 * Animates 0 -> target once.
 */
function useCountUp(
  target: number,
  shouldStart: boolean,
  duration = 1200
) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!shouldStart) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let frame: number;

    if (reduceMotion) {
      frame = requestAnimationFrame(() => {
        setValue(target);
      });

      return () => cancelAnimationFrame(frame);
    }

    const start = performance.now();

    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      setValue(Math.round(target * eased));

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [target, shouldStart, duration]);

  return value;
}

function buildSparklinePath(
  data: PlatformStats["availabilityOverTime"],
  width = 240,
  height = 60
) {
  if (!data || data.length === 0) return "";

  const values = data.map((d) => d.availableUnits);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  return data
    .map((d, i) => {
      const x = (i / (data.length - 1 || 1)) * width;
      const y =
        height - ((d.availableUnits - min) / range) * height;

      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

type Ripple = {
  id: number;
  x: number;
  y: number;
  size: number;
};

/**
 * Compact platform metric tile.
 */
function StatTile({
  icon,
  value,
  delta,
  label,
  children,
}: {
  icon: ReactNode;
  value?: string;
  delta?: string;
  label: string;
  children?: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const card = cardRef.current;

    if (!card) return;

    if (window.matchMedia("(pointer: coarse)").matches) return;

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const rect = card.getBoundingClientRect();

    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;

    card.style.transform = `perspective(700px) rotateX(${
      py * -8
    }deg) rotateY(${px * 8}deg)`;
  }

  function resetTilt() {
    if (cardRef.current) {
      cardRef.current.style.transform =
        "perspective(700px) rotateX(0deg) rotateY(0deg)";
    }
  }

  function handlePointerDown(
    e: PointerEvent<HTMLDivElement>
  ) {
    const rect = e.currentTarget.getBoundingClientRect();

    const size = Math.max(rect.width, rect.height) * 1.4;

    const id = Date.now() + Math.random();

    setRipples((prev) => [
      ...prev,
      {
        id,
        x: e.clientX - rect.left - size / 2,
        y: e.clientY - rect.top - size / 2,
        size,
      },
    ]);

    setTimeout(() => {
      setRipples((prev) =>
        prev.filter((r) => r.id !== id)
      );
    }, 650);
  }

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      onPointerDown={handlePointerDown}
      className="group relative cursor-pointer rounded-2xl transition-transform duration-200 ease-out will-change-transform active:scale-[0.97]"
    >
      <div className="relative z-10 flex min-h-[165px] w-[92%] flex-col gap-2 overflow-hidden rounded-2xl border border-[#CFE0F5] bg-[#EAF2FB] p-4 dark:border-[#223255] dark:bg-[#16233D]">
        {/* Icon */}
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#CFE0F5] bg-white text-[#2C5FA8] transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-6 group-hover:scale-110 group-hover:bg-[#2C5FA8] group-hover:text-white">
          {icon}
        </div>

        {/* Value */}
        {value !== undefined && (
          <span className="text-3xl font-bold leading-none tracking-tight text-[#16233C] transition-colors duration-300 group-hover:text-[#1F4A87] dark:text-[#EDF1F7]">
            {value}
          </span>
        )}

        {/* Delta */}
        {delta && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
            ↑ {delta}
          </span>
        )}

        {/* Label */}
        <span className="text-sm leading-snug text-[#59647A] dark:text-[#9AA6BC]">
          {label}
        </span>

        {children}

        {/* Ripple */}
        {ripples.map((r) => (
          <span
            key={r.id}
            className="pointer-events-none absolute rounded-full bg-[#2C5FA8]/20 animate-[ping_0.6s_ease-out_1]"
            style={{
              width: r.size,
              height: r.size,
              left: r.x,
              top: r.y,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function PlatformStatsSection() {
  const [stats, setStats] =
    useState<PlatformStats | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const [isVisible, setIsVisible] =
    useState(false);

  const panelRef =
    useRef<HTMLDivElement>(null);

  // Load platform statistics from FastAPI
  useEffect(() => {
    let cancelled = false;

    fetchPlatformStats()
      .then((data) => {
        if (!cancelled) {
          setStats(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Something went wrong"
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Start animations when the section becomes visible
  useEffect(() => {
    if (!panelRef.current || loading || !stats) {
      return;
    }

    const observer =
      new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        },
        {
          threshold: 0.3,
        }
      );

    observer.observe(panelRef.current);

    return () => observer.disconnect();
  }, [loading, stats]);

  const manufacturerCount = useCountUp(
    stats?.manufacturerCount ?? 0,
    isVisible
  );

  const machineryCount = useCountUp(
    stats?.machineryCount ?? 0,
    isVisible
  );

  if (loading || error || !stats) {
    return null;
  }

  const sparklinePath =
    buildSparklinePath(
      stats.availabilityOverTime
    );

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-[#F7FAFE] to-white px-6 py-4 dark:from-[#0B1220] dark:via-[#0E1728] dark:to-[#0B1220]">
      {/* Decorative background */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[700px] -translate-x-1/2 rounded-full bg-[#2C5FA8]/5 blur-3xl" />

      {/* Main panel */}
      <div
        ref={panelRef}
        className={`relative mx-auto max-w-6xl rounded-[28px] border border-[#D8E5F5] bg-white/90 p-5 shadow-[0_20px_60px_rgba(18,35,63,0.08)] backdrop-blur-xl transition-all duration-700 ease-out sm:p-6 dark:border-[#223255] dark:bg-[#101A2D]/95 ${
          isVisible
            ? "translate-y-0 opacity-100"
            : "translate-y-4 opacity-0"
        }`}
      >
        {/* Heading */}
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-[#2C5FA8]">
              <span className="h-px w-7 bg-[#2C5FA8]" />
              Platform activity
            </div>

            <h2 className="text-xl font-bold tracking-tight text-[#16233C] sm:text-2xl dark:text-white">
              A growing manufacturing ecosystem
            </h2>

            <p className="mt-1 max-w-2xl text-sm leading-5 text-[#68758B] dark:text-[#9AA6BC]">
              Track manufacturers, machinery capacity,
              and platform availability as the X!Y
              ecosystem grows.
            </p>
          </div>

          {/* Status badge */}
          <div className="hidden rounded-full border border-[#D8E5F5] bg-[#F7FAFE] px-4 py-2 text-xs font-medium text-[#59647A] sm:block dark:border-[#263754] dark:bg-[#16233D] dark:text-[#9AA6BC]">
            Live platform metrics
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Manufacturers */}
          <StatTile
            icon={<ManufacturerIcon />}
            value={manufacturerCount.toLocaleString()}
            delta={
              typeof stats.manufacturerDeltaThisMonth ===
              "number"
                ? `${stats.manufacturerDeltaThisMonth.toLocaleString()} new this month`
                : undefined
            }
            label="Manufacturers on the platform"
          />

          {/* Machinery */}
          <StatTile
            icon={<MachineryIcon />}
            value={machineryCount.toLocaleString()}
            delta={
              typeof stats.machineryDeltaThisMonth ===
              "number"
                ? `${stats.machineryDeltaThisMonth.toLocaleString()} new this month`
                : undefined
            }
            label="Machines available"
          />

          {/* Availability */}
          <StatTile
            icon={<TrendIcon />}
            label="Availability added over time"
          >
            {stats.availabilityOverTime.length >
            0 ? (
              <svg
                viewBox="0 0 240 60"
                preserveAspectRatio="none"
                className="mt-2 h-12 w-full text-[#2C5FA8]"
                role="img"
                aria-label="Machinery availability trend over time"
              >
                <path
                  d={sparklinePath}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: 260,
                    strokeDashoffset:
                      isVisible ? 0 : 260,
                    transition:
                      "stroke-dashoffset 1.1s ease 0.3s",
                  }}
                />
              </svg>
            ) : (
              <div className="mt-3 flex h-10 items-center">
                <div className="flex w-full items-center gap-3">
                  <div className="h-px flex-1 border-t border-dashed border-[#BFD0E6] dark:border-[#344767]" />

                  <span className="text-xs font-medium text-[#8A96A9]">
                    Data coming soon
                  </span>

                  <div className="h-px flex-1 border-t border-dashed border-[#BFD0E6] dark:border-[#344767]" />
                </div>
              </div>
            )}
          </StatTile>
        </div>

        {/* API connection indicator */}
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[#7B8799] dark:text-[#8290A7]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
           X!Y Network
        </div>
      </div>
    </section>
  );
}

/* ---------------- Icons ---------------- */

function ManufacturerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-[19px] w-[19px]"
    >
      <path
        d="M3 21h18M5 21V9l7-4 7 4v12M9 21v-6h6v6M9 12h.01M15 12h.01M9 8h.01M15 8h.01"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MachineryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-[19px] w-[19px]"
    >
      <circle
        cx="12"
        cy="12"
        r="3"
        strokeLinecap="round"
      />

      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-[19px] w-[19px]"
    >
      <path
        d="M3 17l6-6 4 4 8-8M21 7v6h-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}