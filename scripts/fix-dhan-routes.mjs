// One-shot fix to convert the broken DhanError-blind-cast catch pattern in all
// Dhan route handlers to use the new `failFromDhanRouteError` helper.
//
// Before:
//   const err = error as DhanError;
//   return fail(err.code || "FOO_FAILED", err.message, err.status || 500, err.details);
//
// After:
//   return failFromDhanRouteError(error, "FOO_FAILED");
//
// Also: removes the now-unused DhanError import and adds `failFromDhanRouteError`
// to the existing `@/lib/api-response` import.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "app/api/dhan/portfolio/route.ts",
  "app/api/dhan/orders/[orderId]/route.ts",
  "app/api/dhan/trades/[orderId]/route.ts",
  "app/api/dhan/orders/external/[correlationId]/route.ts",
  "app/api/dhan/orders/slicing/route.ts",
  "app/api/dhan/historical/route.ts",
  "app/api/dhan/portfolio/positions/exit-all/route.ts",
  "app/api/dhan/portfolio/positions/convert/route.ts",
  "app/api/dhan/portfolio/positions/route.ts",
  "app/api/dhan/portfolio/holdings/route.ts",
  "app/api/dhan/margin/multi/route.ts",
  "app/api/dhan/margin/route.ts",
  "app/api/dhan/funds/route.ts",
  "app/api/dhan/orders/route.ts",
  "app/api/dhan/trades/route.ts"
];

const catchPattern =
  /(\r?\n)([ \t]*)const err = error as DhanError;\r?\n[ \t]*return fail\(err\.code \|\| ("[A-Z_]+"), err\.message, err\.status \|\| 500, err\.details\);/g;

const dhanImportPattern =
  /^import \{ DhanError \} from "@\/services\/dhan\/dhanClient";\r?\n/m;

const apiResponseImportPattern =
  /^(import \{ )([^}]*?)( \} from "@\/lib\/api-response";)/m;

let changed = 0;
for (const rel of files) {
  const path = resolve(rel);
  let src = readFileSync(path, "utf8");
  const before = src;

  src = src.replace(catchPattern, (_match, nl, indent, code) => {
    return `${nl}${indent}return failFromDhanRouteError(error, ${code});`;
  });

  if (src !== before) {
    // Update the api-response import to also bring in failFromDhanRouteError.
    src = src.replace(apiResponseImportPattern, (match, lead, names, tail) => {
      const set = new Set(
        names.split(",").map((s) => s.trim()).filter(Boolean)
      );
      set.add("failFromDhanRouteError");
      const merged = [...set].sort().join(", ");
      return `${lead}${merged}${tail}`;
    });

    // Drop the now-unused DhanError import (only when no other reference remains).
    const dhanErrorReferencesAfterImport = (() => {
      const withoutImport = src.replace(dhanImportPattern, "");
      return /\bDhanError\b/.test(withoutImport);
    })();
    if (!dhanErrorReferencesAfterImport) {
      src = src.replace(dhanImportPattern, "");
    }

    writeFileSync(path, src, "utf8");
    changed += 1;
    console.log(`updated ${rel}`);
  } else {
    console.log(`no change ${rel}`);
  }
}

console.log(`\n${changed}/${files.length} files updated.`);
