import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { BuildingIcon } from "@/components/manufacturer/icons";

/** A search result: a company imported from public sources that nobody has claimed yet. */
export type CompanyMatch = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  sector: string | null;
  products: string | null;
  website: string | null;
  exactName: boolean;
};

/** Public details of one company, read by its database id after it is selected. */
export type CompanyDetails = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  website: string | null;
  category: string | null;
  capacity: string | null;
  sector: string | null;
  products: string | null;
};

export type CompanyClaim = {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  method: "contact_email" | "business_domain" | "admin_review";
  reason: string | null;
  company: { id: string; name: string; city: string | null; state: string | null };
};

export type ClaimRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** The company the user picked: its database id + displayed name (+ details once loaded). */
export type CompanySelection = {
  id: string;
  name: string;
  match: CompanyMatch;
  details: CompanyDetails | null;
  status: "loading" | "ready" | "error";
};

type Props = {
  /** The Company name input value and setter (the field stays the account form's own field). */
  value: string;
  onChange: (value: string) => void;
  hasError: boolean;
  request: ClaimRequest;
  /** Details of the selected company, or null when the selection is cleared. */
  onSelect: (details: CompanyDetails | null) => void;
  onSelectionChange?: (id: string | null) => void;
  /** Called with the claimed company's name so the form uses the existing record's name. */
  onClaimed: (companyName: string) => void;
};

type SearchState =
  | { status: "idle" }
  | { status: "loading"; q: string }
  | { status: "done"; q: string; results: CompanyMatch[]; hasMore: boolean }
  | { status: "error"; q: string };

const DEBOUNCE_MS = 200;

function place(m: { city: string | null; state: string | null; postalCode?: string | null }) {
  return [m.city, m.state, m.postalCode].filter(Boolean).join(", ");
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** Second line of a result: location and other public details that tell same-name companies apart. */
function meta(m: CompanyMatch) {
  const parts = [place(m), m.sector, m.website].filter(Boolean);
  return parts.length ? parts.join(" · ") : `Location not listed · Ref ${m.id.slice(0, 8).toUpperCase()}`;
}

/**
 * Company name field of the account form with a dropdown of companies imported from public
 * sources (read live from the backend on every change - nothing is cached). Choosing one
 * stores its database id and loads its public details into the form; it does NOT claim,
 * link or change the company. "Claim this company" is a separate step, and the backend
 * decides ownership (verified sign-in email / company domain / XfactorY review).
 */
export function CompanyClaimPanel({ value, onChange, hasError, request, onSelect, onSelectionChange, onClaimed }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [active, setActive] = useState(-1);
  const [selected, setSelected] = useState<CompanySelection | null>(null);
  const [claimsSupported, setClaimsSupported] = useState(true);
  const [claim, setClaim] = useState<CompanyClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [retry, setRetry] = useState(0);
  const searchSeq = useRef(0);
  const detailSeq = useRef(0);

  // An existing pending / approved claim of this user.
  useEffect(() => {
    request<{ claims: CompanyClaim[]; supported?: boolean }>("/manufacturer/claims")
      .then(({ claims, supported }) => {
        setClaimsSupported(supported !== false);
        const current = claims.find((c) => c.status === "pending" || c.status === "approved");
        if (current) {
          setClaim(current);
          if (current.status === "approved") onClaimed(current.company.name);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const query = value.trim();
  // No dropdown while the field shows the selected company's name or a claim is in place.
  const searching = !claim && query.length > 0 && !(selected && selected.name === value);

  // Live search: every change asks the backend; an older response never replaces a newer one.
  useEffect(() => {
    if (!searching) return;
    const mine = ++searchSeq.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearch({ status: "loading", q: query });
      request<{ results: CompanyMatch[]; hasMore?: boolean }>(
        `/manufacturer/claims/search?q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
        .then(({ results, hasMore }) => {
          if (mine !== searchSeq.current || controller.signal.aborted) return;
          setSearch({ status: "done", q: query, results, hasMore: !!hasMore });
          setActive(-1);
        })
        .catch(() => {
          if (mine !== searchSeq.current || controller.signal.aborted) return;
          setSearch({ status: "error", q: query });
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searching, request, retry]);

  function loadDetails(match: CompanyMatch) {
    const mine = ++detailSeq.current;
    setSelected({ id: match.id, name: match.name, match, details: null, status: "loading" });
    request<CompanyDetails>(`/manufacturer/claims/companies/${encodeURIComponent(match.id)}`)
      .then((details) => {
        if (mine !== detailSeq.current) return; // another company was picked meanwhile
        setSelected({ id: match.id, name: match.name, match, details, status: "ready" });
        onSelect(details);
      })
      .catch(() => {
        if (mine !== detailSeq.current) return;
        setSelected({ id: match.id, name: match.name, match, details: null, status: "error" });
        onSelect(null);
        onSelectionChange?.(match.id);
      });
  }

  function choose(match: CompanyMatch) {
    searchSeq.current++;
    setOpen(false);
    setActive(-1);
    setClaimError("");
    onSelect(null); // drop the previous company's details before the new ones arrive
    onSelectionChange?.(match.id);
    onChange(match.name);
    loadDetails(match);
  }

  function clearSelection() {
    detailSeq.current++;
    setSelected(null);
    onSelect(null);
    onSelectionChange?.(null);
  }

  function handleChange(next: string) {
    onChange(next);
    setOpen(true);
    // Editing the name after choosing a company drops that company and its details.
    if (selected && next !== selected.name) clearSelection();
  }

  const shown = searching && search.status !== "idle" && "q" in search && search.q === query ? search : null;
  const results = shown && shown.status === "done" ? shown.results : [];
  const dropdownOpen = open && searching;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen) return;
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0 && results[active]) {
      event.preventDefault(); // pick the company instead of submitting the form
      choose(results[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  async function claimCompany() {
    if (!selected || !claimsSupported) return;
    setBusy(true);
    setClaimError("");
    try {
      const result = await request<CompanyClaim>("/manufacturer/claims", {
        method: "POST",
        body: JSON.stringify({ organizationId: selected.id }),
      });
      setClaim(result);
      onClaimed(result.company.name);
    } catch (e) {
      setClaimError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelClaim() {
    if (!claim) return;
    setBusy(true);
    setClaimError("");
    try {
      await request<CompanyClaim>(`/manufacturer/claims/${claim.id}/cancel`, { method: "POST" });
      setClaim(null);
    } catch (e) {
      setClaimError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="company-combobox">
        <div className="account-input-wrap">
          <span className="input-icon">
            <BuildingIcon size={16} />
          </span>
          <input
            type="text"
            id="acc-company"
            placeholder="Acme Manufacturing Co."
            className={hasError ? "error" : ""}
            value={value}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={dropdownOpen}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
          />
        </div>

        {dropdownOpen ? (
          <div className="company-dd" id={listId} role="listbox" aria-label="Listed companies">
            {!shown || shown.status === "loading" ? (
              <p className="company-dd-status" role="status">Searching listed companies…</p>
            ) : shown.status === "error" ? (
              <p className="company-dd-status error" role="alert">
                Couldn’t load companies.{" "}
                <button
                  type="button"
                  className="btn-text"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Try again
                </button>
              </p>
            ) : results.length === 0 ? (
              <p className="company-dd-status" role="status">
                No listed company matches “{query}”. You can continue with this name as a new company.
              </p>
            ) : (
              <>
                {results.map((m, i) => (
                  <div
                    key={m.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={`company-dd-item${i === active ? " active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(m)}
                  >
                    <span className="company-dd-name">{m.name}</span>
                    <span className="company-dd-meta">{meta(m)}</span>
                  </div>
                ))}
                {shown.hasMore ? (
                  <p className="company-dd-status">Keep typing to narrow the list.</p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {!claimsSupported && selected ? <p className="field-error">Company selection is available. Claims require the existing claim workflow to be configured; no ownership has been granted.</p> : null}
      {claim ? (
        <div className="terms-box claim-box" role="status">
          {claim.status === "approved" ? (
            <p className="claim-text">
              <strong>Linked to {claim.company.name}</strong>
              {place(claim.company) ? ` · ${place(claim.company)}` : ""}. Its listed details are loaded
              into your account — review them after you finish this form.
            </p>
          ) : (
            <>
              <p className="claim-text">
                <strong>Claim for {claim.company.name} is waiting for review.</strong> We couldn’t
                confirm it from your verified sign-in email, so the XfactorY team will check it with the
                company’s listed contacts. You can finish this form in the meantime.
              </p>
              <button type="button" className="btn-text" disabled={busy} onClick={cancelClaim}>
                {busy ? "Cancelling…" : "Cancel claim"}
              </button>
            </>
          )}
          {claimError ? <p className="field-error">{claimError}</p> : null}
        </div>
      ) : selected ? (
        <div className="terms-box claim-box" data-company-id={selected.id}>
          <p className="claim-text">
            <strong>{selected.name}</strong>
            {meta(selected.match) ? ` · ${meta(selected.match)}` : ""}
          </p>
          {selected.status === "loading" ? (
            <p className="account-required-note" role="status">Loading company details…</p>
          ) : selected.status === "error" ? (
            <p className="field-error" role="alert">
              Couldn’t load this company’s details.{" "}
              <button type="button" className="btn-text" onClick={() => loadDetails(selected.match)}>
                Try again
              </button>
            </p>
          ) : (
            <p className="account-required-note">
              This company is listed on XfactorY. Claim it to link your account to it — selecting it does
              not change the listing. Signed in with your company email? We can verify you instantly;
              otherwise the XfactorY team reviews the claim.
            </p>
          )}
          <div className="claim-actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={!claimsSupported || busy || selected.status !== "ready"}
              onClick={claimCompany}
            >
              {busy ? "Claiming…" : "Claim this company"}
            </button>
            <button type="button" className="btn-text" onClick={clearSelection}>
              Not my company
            </button>
          </div>
          {claimError ? <p className="field-error">{claimError}</p> : null}
        </div>
      ) : null}
    </>
  );
}
