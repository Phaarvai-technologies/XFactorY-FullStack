type ClerkErrorItem = {
  code?: string;
  longMessage?: string;
  message?: string;
  meta?: {
    paramName?: string;
  };
};

type ClerkErrorShape = {
  errors?: ClerkErrorItem[];
};

export type ParsedClerkError = {
  code: string | null;
  message: string;
  paramName: string | null;
};

export function parseClerkError(error: unknown): ParsedClerkError {
  const fallback = "Something went wrong. Please try again.";

  if (typeof error === "object" && error !== null && "errors" in error) {
    const first = (error as ClerkErrorShape).errors?.[0];
    if (first) {
      return {
        code: first.code ?? null,
        message: first.longMessage ?? first.message ?? fallback,
        paramName: first.meta?.paramName ?? null,
      };
    }
  }

  if (error instanceof Error && error.message) {
    return {
      code: null,
      message: error.message,
      paramName: null,
    };
  }

  return {
    code: null,
    message: fallback,
    paramName: null,
  };
}
