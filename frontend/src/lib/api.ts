const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown,
  ) {
    let message = `API request failed with ${status}`;

    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      message = detail
        .map((item) => {
          const field = Array.isArray(item?.loc)
            ? item.loc[item.loc.length - 1]
            : "field";

          return `${field}: ${item?.msg ?? "Invalid value"}`;
        })
        .join(", ");
    }

    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, payload?.detail ?? "API request failed");
  }
  return payload as T;
}

