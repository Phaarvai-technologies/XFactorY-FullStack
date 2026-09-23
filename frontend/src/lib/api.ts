export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
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
  if (!response.ok) throw new ApiError(response.status, payload?.detail ?? "API request failed");
  return payload as T;
}
