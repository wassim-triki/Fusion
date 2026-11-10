/**
 * Design-role guards for every Fusion-owned app; the guards and their reasons are in design-roles-guards.js.
 * @type {import("eslint").Linter.Config}
 */
const { guards } = require("./design-roles-guards");

/** One icon set (D-78): every glyph comes from Hugeicons through `@repo/ds/icons`. */
const iconImports = [
  "warn",
  { paths: [{ name: "lucide-react", message: "Import icons from \"@repo/ds/icons\" (Fusion's Hugeicons set)." }] },
];

module.exports = {
  rules: { "no-restricted-syntax": ["warn", ...guards], "no-restricted-imports": iconImports },
};
