import { FUSION_MODULES } from "@repo/ds/shell";
import type { Say } from "@repo/ds/lib/say";
import { sayProvisioningInEnglish } from "./provisioning-form-state";
import type { ProvisionableModule, TenantModule } from "../api";

/**
 * The modules a Platform Administrator sees when provisioning a tenant.
 *
 * Two sources meet here, and neither is guessed:
 *
 * - which modules Fusion has, from the shell's own registry — the same list the
 *   module switcher renders, so the workspace cannot silently omit one;
 * - which of them provisioning accepts, from the service that enforces it.
 *
 * Availability is therefore derived, never declared: a module is unavailable
 * precisely because the service does not list it, so this file cannot drift out
 * of step with what a request would actually be refused for. Adding a module to
 * the backend enum makes it selectable here with no change to this code.
 */

export type ModuleAvailability = "included" | "selectable" | "unavailable";

export interface ProvisioningModuleOption {
  /** The shell registry key. Stable, and unique across Fusion. */
  key: string;
  label: string;
  description: string;
  icon: (typeof FUSION_MODULES)[number]["icon"];
  availability: ModuleAvailability;
  /**
   * The identifier a provisioning request would carry. Null for a module the
   * service does not accept, which is what makes it impossible to submit one.
   */
  module: TenantModule | null;
}

/**
 * The shell registry names modules for navigation; provisioning names them for
 * entitlement. Most keys already match their identifier case-insensitively
 * (`performance` → `Performance`), so only the genuine irregularities are
 * listed: Core HR navigates as `core` but is entitled as `CoreHR`.
 *
 * Resolution falls back to the case-insensitive match, so a module the service
 * begins accepting becomes selectable here without a code change. This bridge
 * says what a key is called — never whether it is available.
 */
const KEY_ALIASES: Record<string, string> = {
  core: "corehr",
};

function resolveModule(
  key: string,
  accepted: ReadonlyMap<string, TenantModule>
): TenantModule | null {
  return accepted.get(KEY_ALIASES[key] ?? key.toLowerCase()) ?? null;
}

/**
 * Descriptions written for someone deciding what a tenant should be entitled to,
 * rather than the navigation captions the switcher uses
 * (`provisioning.moduleDescriptions.<key>`).
 */
const DESCRIBED_MODULES = new Set(["core", "performance", "learning", "recruitment", "interview"]);

export function buildModuleOptions(
  provisionable: readonly ProvisionableModule[],
  say: Say = sayProvisioningInEnglish
): ProvisioningModuleOption[] {
  // Keyed by the lowercased identifier so a registry key can find it without
  // either side having to agree on casing.
  const byLowercaseId = new Map<string, TenantModule>(
    provisionable.map((entry) => [entry.module.toLowerCase(), entry.module])
  );
  const mandatoryModules = new Set(
    provisionable
      .filter((entry) => entry.mandatory)
      .map((entry) => entry.module)
  );

  const options = FUSION_MODULES.map((registryModule) => {
    const entitlement = resolveModule(registryModule.key, byLowercaseId);
    const mandatory =
      entitlement === null ? undefined : mandatoryModules.has(entitlement);

    return {
      key: registryModule.key,
      label: registryModule.label,
      description: DESCRIBED_MODULES.has(registryModule.key)
        ? say(`moduleDescriptions.${registryModule.key}`)
        : (registryModule.description ?? ""),
      icon: registryModule.icon,
      // Unknown to the service means unavailable, whatever the registry says.
      availability: (mandatory === undefined
        ? "unavailable"
        : mandatory
          ? "included"
          : "selectable") as ModuleAvailability,
      // Deliberately dropped for an unavailable module, so there is no
      // identifier for a request to carry even by mistake.
      module: mandatory === undefined ? null : entitlement,
    };
  });

  // Included first, then what can be chosen, then what cannot: the grid reads
  // in the order the decision is actually made.
  const rank: Record<ModuleAvailability, number> = {
    included: 0,
    selectable: 1,
    unavailable: 2,
  };

  return options.sort(
    (a, b) =>
      rank[a.availability] - rank[b.availability] ||
      a.label.localeCompare(b.label)
  );
}

/**
 * The entitlements a request should carry. Only modules the service accepts and
 * the operator selected — never a mandatory one, which the service adds itself,
 * and never an unavailable one, which has no identifier to send.
 */
export function selectedModulesFor(
  options: readonly ProvisioningModuleOption[],
  selectedKeys: readonly string[]
): TenantModule[] {
  return options
    .filter(
      (option) =>
        option.availability === "selectable" &&
        option.module !== null &&
        selectedKeys.includes(option.key)
    )
    .map((option) => option.module!);
}
