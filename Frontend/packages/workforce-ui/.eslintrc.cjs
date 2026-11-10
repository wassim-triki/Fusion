module.exports = {
  root: true,
  extends: ["@repo/eslint-config/base"],
  rules: {
    "no-restricted-imports": ["warn", { paths: [{ name: "lucide-react", message: "Import icons from \"@repo/ds/icons\" (Fusion's Hugeicons set)." }] }],
  },
  parserOptions: {
    project: true,
  },
  ignorePatterns: ["dist"],
};
