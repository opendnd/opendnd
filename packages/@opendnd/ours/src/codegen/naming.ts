/** `canon-status` or `canon_status` or `Canon Status` -> `CanonStatus`. */
export function toPascalCase(input: string): string {
  return input
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

/** `canon-status` -> `canonStatus`. */
export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : pascal;
}

/** Safe identifier for a property key in emitted code. */
export function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}
