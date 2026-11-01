import { describe, expect, it } from "vitest";
import { bringFraction } from "./bring-frame";
import { checkFiles } from "./import-drop";

const file = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name);

describe("the import, on the client", () => {
  it("takes Excel and CSV files up to 10 MB, twelve at a time", () => {
    expect(checkFiles([file("people.xlsx"), file("units.csv")])).toBeNull();
    expect(checkFiles([file("people.pdf")])).toBeNull();
    expect(checkFiles([file("big.csv", 10 * 1024 * 1024 + 1)])).toEqual({ problem: "size", name: "big.csv" });
    expect(checkFiles(Array.from({ length: 13 }, (_, i) => file(`f${i}.csv`)))).toEqual({ problem: "many" });
  });

  it("moves the bar only with what has been created", () => {
    const at = (phase: "units" | "jobs" | "people" | "lines" | "saving", people = 0, lines = 0) =>
      bringFraction({ phase, units: 0, jobs: 0, people, reportingLines: lines }, 100, 99);
    expect(at("people", 0)).toBeLessThan(at("people", 50));
    expect(at("people", 100)).toBeLessThanOrEqual(at("lines", 0, 0));
    expect(at("lines", 0, 99)).toBeLessThan(at("saving"));
    expect(bringFraction(null, 100, 99)).toBe(0);
  });
});
