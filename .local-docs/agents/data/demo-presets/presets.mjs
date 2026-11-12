// The five presets (D-41), every date counted from the run day D (design D9). Each returns the foundation's as-of
// date and a schedule that fills a timeline; history presets share last year's closed, released cycle.
import { addDays, companySetup, conversations, draftCycle, readNotifications, runCycle } from "./year.mjs";

const fy = (end) => `FY${end.getUTCFullYear()}`;

/** This year's cycle from its start, with last year's closed and released one before it. */
function years(start) {
  const end = addDays(start, 364);
  const lastStart = addDays(start, -365);
  const lastEnd = addDays(start, -1);
  const release = addDays(lastEnd, -18);
  const last = {
    key: "last", name: fy(lastEnd), start: lastStart, end: lastEnd, deadline: addDays(lastStart, 30), cadence: 90,
    round: { launch: addDays(release, -22), selfDue: addDays(release, -12), managerDue: addDays(release, -6), release },
  };
  const current = { key: "current", name: fy(end), start, end, deadline: addDays(start, 30), cadence: 30 };
  return { last, current, asOf: addDays(lastStart, -40) };
}

function history(t, ctx, D, last, current) {
  companySetup(t, ctx, addDays(last.start, -20));
  runCycle(t, ctx, last);
  runCycle(t, ctx, current);
  conversations(t, ctx, addDays(last.start, 14), D);
  readNotifications(t, ctx, addDays(D, -7));
}

const next = (start) => ({ key: "next", name: fy(addDays(start, 364)), start, end: addDays(start, 364), deadline: addDays(start, 30) });

export const PRESETS = {
  fresh: {
    label: "Fresh",
    summary: "Organization, workforce and accounts; nothing in Performance yet.",
    plan: (D) => ({ asOf: addDays(D, -30), schedule: () => {} }),
  },
  planning: {
    label: "Planning",
    summary: "This year started 12 days ago, planning closes in 18 days; last year closed with released results.",
    plan: (D) => {
      const { last, current, asOf } = years(addDays(D, -12));
      return { asOf, schedule: (t, ctx) => history(t, ctx, D, last, current) };
    },
  },
  midyear: {
    label: "Mid-year",
    summary: "About 180 days in: plans approved, monthly check-ins, 1:1s, feedback and praise.",
    plan: (D) => {
      const { last, current, asOf } = years(addDays(D, -180));
      current.askUpdateAt = addDays(D, -4);
      return { asOf, schedule: (t, ctx) => history(t, ctx, D, last, current) };
    },
  },
  yearend: {
    label: "Year-end",
    summary: "The cycle ends in 14 days; the Year-end round launched 10 days ago; next year's cycle waits in Draft.",
    plan: (D) => {
      const end = addDays(D, 14);
      const { last, current, asOf } = years(addDays(end, -364));
      current.askUpdateAt = addDays(D, -4);
      current.round = { launch: addDays(D, -10), selfDue: addDays(D, 4), managerDue: addDays(D, 11) };
      return {
        asOf,
        schedule: (t, ctx) => {
          history(t, ctx, D, last, current);
          draftCycle(t, ctx, next(addDays(end, 1)), addDays(D, -3));
        },
      };
    },
  },
  nextcycle: {
    label: "Next cycle",
    summary: "This year ended 2 days ago with released results; next year is set up and ready to launch.",
    plan: (D) => {
      const end = addDays(D, -2);
      const { last, current, asOf } = years(addDays(end, -364));
      const release = addDays(D, -9);
      current.round = { launch: addDays(release, -22), selfDue: addDays(release, -12), managerDue: addDays(release, -6), release };
      return {
        asOf,
        schedule: (t, ctx) => {
          history(t, ctx, D, last, current);
          draftCycle(t, ctx, next(addDays(D, 1)), addDays(D, -3));
        },
      };
    },
  },
};
