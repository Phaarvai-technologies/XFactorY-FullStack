import { stripBase, withBase } from "@/lib/basePath";
import { authPageHref } from "@/lib/auth/registration";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null = null,
    /** The full error body (e.g. existingId for a duplicate company). */
    public data: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

/**
 * The backend refused a Clerk session whose user never completed X!Y sign-up (403
 * registration_required), e.g. a session that predates registration checks. End it and go to
 * Sign-up with the notice. Once per page; only this explicit answer triggers it.
 */
let leavingForSignUp = false;
function handleRegistrationRequired(): void {
  if (typeof window === "undefined" || leavingForSignUp) return;
  leavingForSignUp = true;
  const back = stripBase(`${window.location.pathname}${window.location.search}`);
  const target = withBase(authPageHref("/sign-up", back, "signup_required"));
  const clerk = (window as unknown as { Clerk?: { signOut?: (o?: { redirectUrl?: string }) => Promise<unknown> } }).Clerk;
  // Clerk navigates after signing out: send it straight to the Sign-up notice (not the home page).
  void Promise.resolve(clerk?.signOut?.({ redirectUrl: target }))
    .catch(() => undefined)
    .finally(() => window.location.assign(target));
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
    });
  } catch {
    throw new ApiError(0, `Cannot reach backend at ${API_URL}`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof payload?.code === "string" ? payload.code : null;
    if (response.status === 403 && code === "registration_required") handleRegistrationRequired();
    throw new ApiError(response.status, payload?.detail ?? "API request failed", code,
                       payload && typeof payload === "object" ? payload : null);
  }
  return payload as T;
}



export interface CompanySearchResult {
  /** Database id of the company record; kept when the user selects it. */
  id: string;
  companyName: string;
  country: string | null;
  /** Headquarters location, shown so companies with similar names can be told apart. */
  city?: string | null;
  state?: string | null;
  companyType: string | null;
  claimed?: boolean;
  ownedByYou?: boolean;
}

/** GET /manufacturer/companies/{id}: saved details of exactly that record (prefill only). */
export interface CompanyDetails {
  id: string;
  companyName: string;
  companyType: string;
  country: string;
  city: string;
  state: string;
  capacity: string;
  /** Only returned to the company's own owner. */
  phone: string;
  access: "owner" | "claimed" | "unclaimed";
  canUpdate: boolean;
}

export interface CompanySearchResponse {
  items: CompanySearchResult[];
}

export async function searchManufacturerCompanies(
  query: string,
  token: string
): Promise<CompanySearchResponse> {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    return { items: [] };
  }

  return api<CompanySearchResponse>(
    `/manufacturer/companies/search?q=${encodeURIComponent(trimmedQuery)}`,
    token
  );
}