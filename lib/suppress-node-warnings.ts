const SUPPRESSED_WARNING_CODES = new Set(["DEP0169"]);

type WarningCtor = (new (...args: unknown[]) => Error) | ((...args: unknown[]) => void);

const globalForWarningSuppressions = globalThis as typeof globalThis & {
  __saharaWarningSuppressionsInstalled?: boolean;
};

function getWarningCode(
  warning: string | Error,
  typeOrOptions?: string | NodeJS.EmitWarningOptions | WarningCtor,
  codeOrCtor?: string | WarningCtor
) {
  const warningCode = (warning as Error & { code?: unknown }).code;
  if (warning instanceof Error && typeof warningCode === "string") {
    return warningCode;
  }

  if (typeof codeOrCtor === "string") {
    return codeOrCtor;
  }

  if (
    typeOrOptions &&
    typeof typeOrOptions === "object" &&
    typeof typeOrOptions.code === "string"
  ) {
    return typeOrOptions.code;
  }

  return undefined;
}

export function installNodeWarningSuppressions() {
  if (typeof process === "undefined" || globalForWarningSuppressions.__saharaWarningSuppressionsInstalled) {
    return;
  }

  const originalEmitWarning = process.emitWarning;

  const patchedEmitWarning = function(
    warning: string | Error,
    typeOrOptions?: string | NodeJS.EmitWarningOptions | WarningCtor,
    codeOrCtor?: string | WarningCtor,
    ctor?: WarningCtor
  ) {
    const code = getWarningCode(warning, typeOrOptions, codeOrCtor);
    if (code && SUPPRESSED_WARNING_CODES.has(code)) return;

    if (typeof typeOrOptions === "string") {
      return originalEmitWarning(warning, {
        type: typeOrOptions,
        code: typeof codeOrCtor === "string" ? codeOrCtor : undefined,
        ctor: typeof codeOrCtor === "function" ? codeOrCtor : ctor
      });
    }

    if (typeof typeOrOptions === "function") {
      return originalEmitWarning(warning, { ctor: typeOrOptions });
    }

    return originalEmitWarning(warning, typeOrOptions);
  } as typeof process.emitWarning;

  process.emitWarning = patchedEmitWarning;

  globalForWarningSuppressions.__saharaWarningSuppressionsInstalled = true;
}
