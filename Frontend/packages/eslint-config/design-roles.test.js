// Fixtures for the design-role guards: `node --test` from this package.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Linter } = require("eslint");
const designRoles = require("./design-roles");
const designRolesType = require("./design-roles-type");

function warnings(code) {
  const linter = new Linter();
  return linter
    .verify(code, {
      ...designRoles,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    })
    .map((message) => message.message);
}

test("left padding warns and names the start form", () => {
  const found = warnings(`const a = <div className="flex pl-4" />;`);
  assert.equal(found.length, 1);
  assert.match(found[0], /use ps-\* instead of pl-\*/);
});

test("each physical family names its logical form", () => {
  const cases = {
    "ml-2": "ms-*",
    "-mr-1": "me-*",
    "md:hover:pr-3": "pe-*",
    "left-0": "inset-s-*",
    "right-[3px]": "inset-e-*",
    "text-right": "text-end",
    "border-l-2": "border-s-*",
    "border-r": "border-e-*",
    "rounded-tl-control": "rounded-ss-*",
    "scroll-ml-4": "scroll-ms-*",
    "float-left": "float-start",
  };
  for (const [className, logical] of Object.entries(cases)) {
    const found = warnings(`const a = "${className}";`);
    assert.equal(found.length, 1, className);
    assert.ok(found[0].includes(`use ${logical}`), `${className}: ${found[0]}`);
  }
});

test("template literals are checked too", () => {
  assert.equal(warnings("const a = `flex ${b} pr-2`;").length, 1);
});

test("centring, symmetric utilities, ltr:/rtl: and logical forms do not warn", () => {
  for (const className of [
    "left-1/2 -translate-x-1/2",
    "-left-1/2 right-1/2",
    "rtl:pl-4 ltr:text-left",
    "md:rtl:mr-2",
    "inset-x-0 space-x-2 translate-x-1",
    "ps-4 me-2 inset-s-0 text-start border-s rounded-ss-control",
    "slide-in-from-left-2 origin-left",
    "simple-pl-4 template-left-0",
  ]) {
    assert.deepEqual(warnings(`const a = "${className}";`), [], className);
  }
});

test("a fixed or browser locale warns and points to the shared formatters", () => {
  const cases = {
    'new Intl.NumberFormat("en-GB").format(n);': "@repo/ds/lib/numbers",
    'Intl.NumberFormat(undefined, { notation: "compact" });': "@repo/ds/lib/numbers",
    'new Intl.DateTimeFormat("en-US", { month: "short" });': "@repo/ds/lib/dates",
    'date.toLocaleDateString("en-GB", { day: "numeric" });': "@repo/ds/lib/dates",
    "date.toLocaleTimeString();": "@repo/ds/lib/dates",
    "count.toLocaleString();": "@repo/ds/lib/numbers",
    'count.toLocaleString("en-GB");': "@repo/ds/lib/numbers",
  };
  for (const [code, pointer] of Object.entries(cases)) {
    const found = warnings(code);
    assert.equal(found.length, 1, code);
    assert.ok(found[0].includes(pointer), `${code}: ${found[0]}`);
  }
});

test("the shared formatters' own locale constant and locale detection do not warn", () => {
  for (const code of [
    "new Intl.DateTimeFormat(LOCALE, { day: 'numeric' });",
    "new Intl.NumberFormat(FORMAT_LOCALE).format(n);",
    "Intl.DateTimeFormat().resolvedOptions().timeZone;",
    "date.toLocaleString(locale?.code, { month: 'short' });",
  ]) {
    assert.deepEqual(warnings(code), [], code);
  }
});

test("raw text sizes and weights stacked on a role or size warn under typeRoles", () => {
  const strict = (code) => {
    const linter = new Linter();
    return linter
      .verify(code, { ...designRolesType, parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } } })
      .map((message) => message.message);
  };
  for (const className of ["text-sm", "flex text-xs", "md:text-base", "text-[11px] tabular-nums", "type-meta font-semibold", "text-sm font-medium", "`gap-2 ${a} text-lg`"]) {
    const code = className.startsWith("`") ? `const a = ${className};` : `const a = "${className}";`;
    assert.ok(strict(code).some((m) => m.includes("type role")), className);
  }
  for (const className of ["type-body", "type-meta-strong text-muted-foreground", "font-semibold", "text-muted-foreground text-start", "text-[var(--x)]", "type-label"]) {
    assert.deepEqual(strict(`const a = "${className}";`).filter((m) => m.includes("type role")), [], className);
  }
  // The default config doesn't carry the guard yet.
  assert.deepEqual(warnings(`const a = "text-sm";`), []);
});

test("hand-made choosers warn and name the choice controls", () => {
  for (const code of [
    `const a = <button aria-pressed={on} />;`,
    `const a = <div role="radiogroup" />;`,
    `import { ToggleGroup } from "@repo/ds";`,
    `import { RadioGroup, RadioGroupItem } from "@repo/ds/components/ui/radio-group";`,
    `import { ToggleGroupItem } from "@repo/ds/components/ui/toggle-group";`,
  ]) {
    const found = warnings(code);
    assert.ok(found.length >= 1, code);
    assert.match(found[0], /@repo\/ds\/choice/);
  }
});

test("the choice controls themselves and other roles pass", () => {
  for (const code of [
    `import { Segmented, FilterChips } from "@repo/ds/choice";`,
    `const a = <div role="group" />;`,
    `import { DropdownMenuRadioGroup } from "@repo/ds";`,
  ]) {
    assert.deepEqual(warnings(code), [], code);
  }
});

test("a native date input warns and points to the DS date picker", () => {
  const found = warnings(`const a = <Input type="date" value={v} />;`);
  assert.equal(found.length, 1);
  assert.match(found[0], /DatePicker/);
  assert.equal(warnings(`const a = <Input type="text" />;`).length, 0);
});
