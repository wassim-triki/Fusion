// B-331/B-350: the walkthrough's import files, written the way a customer would export them (the shape accepted in
// B-186): an employee list with its own headers (Emp No, Full name, Email, Position, Grade, Dept, Reports to, Location,
// Start, Salary, Status) and a department list (Code, Unit, Parent, Type). What the import has to work out: Grade only
// half-recognised, one person's department missing from the department list, "QA Automation Eng." beside
// "QA Automation Engineer", a Salary column to leave out, three people who have left. Emails use the company's own
// domain, so Amira's row is the account she activated. Writes no application data.
// Run: node .local-docs/agents/data/make-walkthrough-import-files.mjs <company email domain>
//      e.g. walkthrough-202611082348.example.test   → data/demo-presets/.work/walkthrough/
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { organization, roster } from "./demo-presets/foundation.mjs";

const domain = process.argv[2];
if (!domain) throw new Error("Give the company's email domain, e.g. walkthrough-202611082348.example.test");
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "demo-presets", ".work", "walkthrough");
await fs.mkdir(OUT, { recursive: true });

const people = roster(domain, new Date().toISOString().slice(0, 10));
const { rows: units } = organization();
const csv = (rows) => rows.map((cells) => cells.map((cell) => {
  const text = String(cell ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(",")).join("\n");
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const grade = (title) => (/^Chief/.test(title) ? (title.includes("Executive") ? "E1" : "E2") : /^VP/.test(title) ? "M2" : /Manager$/.test(title) ? "M1" : /^Senior|Architect/.test(title) ? "L4" : "L3");
const numberOf = new Map(people.map((p) => [p.workerReference, p.employeeNumber]));
const qa = people.filter((p) => p.title === "QA Automation Engineer");
const hiba = people.find((p) => p.firstName === "Hiba") ?? people[40];
const staff = people.map((p) => [
  p.employeeNumber, p.name, p.email, p === qa.at(-1) ? "QA Automation Eng." : p.title, grade(p.title),
  p === hiba ? "PGC" : p.organization, numberOf.get(p.managerReference) ?? "", p.location, dmy(p.startDate),
  String(2400 + ((p.index * 137) % 7000)), "Active",
]);
const leavers = [["CDG-201", "Walid Hamdi", `walid.hamdi@${domain}`, "Software Engineer", "L3", "CDG-TECH-2-D1-T1", "CDG-006", "Tunis", "03/02/2019", "3100", "Left"],
  ["CDG-202", "Sarra Jlassi", `sarra.jlassi@${domain}`, "Product Analyst", "L3", "CDG-TECH-1-D1-T1", "CDG-005", "Sfax", "11/09/2020", "2900", "Left"],
  ["CDG-203", "Karim Ayari", `karim.ayari@${domain}`, "Finance Analyst", "L3", "CDG-CORP-1-D1-T1", "CDG-009", "Tunis", "21/06/2018", "3000", "Left"]];

const peoplePath = path.join(OUT, "Carthage employees 2026.csv");
const unitsPath = path.join(OUT, "Carthage departments.csv");
await fs.writeFile(peoplePath, csv([["Emp No", "Full name", "Email", "Position", "Grade", "Dept", "Reports to", "Location", "Start", "Salary", "Status"], ...staff, ...leavers]));
await fs.writeFile(unitsPath, csv([["Code", "Unit", "Parent", "Type"], ...units.map(([, code, name, type, parent]) => [code, name, parent, type === "Organization" ? "Company" : type])]));
const cast = ["Amira", "Mariam", "Aicha"].map((first) => people.find((p) => p.firstName === first)).filter(Boolean);
console.log(`${staff.length + leavers.length} people, ${units.length} units → ${OUT}`);
for (const p of cast) console.log(`  ${p.name} · ${p.title} · ${p.email} · reports to ${numberOf.get(p.managerReference) ?? "nobody"}`);
