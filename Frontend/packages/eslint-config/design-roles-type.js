/**
 * The design-role guards plus raw typography, for apps already on type roles (Performance first). One config
 * carries every guard, since a second config setting this rule would replace its options.
 * @type {import("eslint").Linter.Config}
 */
const { guards, typographyGuards } = require("./design-roles-guards");

/** One icon set (D-78): every glyph comes from Hugeicons through `@repo/ds/icons`. */
const iconImports = [
  "warn",
  { paths: [{ name: "lucide-react", message: "Import icons from \"@repo/ds/icons\" (Fusion's Hugeicons set)." }] },
];

module.exports = {
  rules: { "no-restricted-syntax": ["warn", ...guards, ...typographyGuards], "no-restricted-imports": iconImports },
};
