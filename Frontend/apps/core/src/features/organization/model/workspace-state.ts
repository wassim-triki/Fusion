export type OrganizationRepresentation = "chart" | "outline";

export interface OrganizationUrlState {
  representation: OrganizationRepresentation;
  asOf: string;
  selectedId: string | null;
  search: string;
}

export interface MoveProposal {
  sourceId: string;
  fromParentId: string | null;
  toParentId: string | null;
  effectiveDate: string;
  version: number;
  subordinateCount: number;
  entry: "drag" | "explicit";
  error: string | null;
}

export type UnitFormMode = { kind: "add"; parentId: string | null } | { kind: "edit"; unit: OrganizationUnitStateDto } | null;

// The contextual side panel holds exactly one editor at a time. Modelling it as a
// single value (rather than independent flags resolved by render priority) makes it
// impossible to open one editor while another is silently still set — the class of
// bug where clicking an action changed state but a higher-priority panel masked it.
export type OrganizationEditor =
  | { kind: "unit-form"; mode: Exclude<UnitFormMode, null> }
  | { kind: "correction"; unit: OrganizationUnitStateDto; date: string }
  | { kind: "manage-types" };

export interface OrganizationLocalState {
  collapsed: Set<string>;
  editor: OrganizationEditor | null;
  createType: boolean;
  createdTypeId: string | null;
  upcomingOpen: boolean;
  moveProposal: MoveProposal | null;
  inactivateUnit: OrganizationUnitStateDto | null;
  cancelChange: OrganizationChangeDto | null;
  inspectorOpen: boolean;
}

export type OrganizationLocalAction =
  | { type: "patch"; value: Partial<OrganizationLocalState> }
  | { type: "toggle-collapse"; id: string }
  | { type: "reveal"; id: string; model: OrganizationHierarchyModel };

export function organizationLocalReducer(state: OrganizationLocalState, action: OrganizationLocalAction): OrganizationLocalState {
  if (action.type === "patch") return { ...state, ...action.value };
  if (action.type === "reveal") return { ...state, collapsed: revealOrganizationUnit(state.collapsed, action.model, action.id) };
  const collapsed = new Set(state.collapsed);
  if (collapsed.has(action.id)) collapsed.delete(action.id); else collapsed.add(action.id);
  return { ...state, collapsed };
}

export function todayCalendarDate(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readOrganizationUrlState(params: URLSearchParams, today = todayCalendarDate()): OrganizationUrlState {
  return {
    representation: params.get("view") === "list" ? "outline" : "chart",
    asOf: params.get("asOf") || today,
    selectedId: params.get("unit"),
    search: params.get("q") ?? "",
  };
}

export function writeOrganizationUrlState(state: OrganizationUrlState, today = todayCalendarDate()) {
  const params = new URLSearchParams();
  if (state.representation === "outline") params.set("view", "list");
  if (state.asOf !== today) params.set("asOf", state.asOf);
  if (state.selectedId) params.set("unit", state.selectedId);
  if (state.search) params.set("q", state.search);
  return params;
}

export function organizationCodeSuggestion(name: string) {
  const words = name.trim().toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 8);
  return words.map((word) => word[0]).join("").slice(0, 8);
}
import type { OrganizationChangeDto, OrganizationUnitStateDto } from "@repo/api";
import { revealOrganizationUnit, type OrganizationHierarchyModel } from "./hierarchy";
