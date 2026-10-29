"use client";

import { useState } from "react";
import { useRefreshFusionAttention } from "@repo/api/query";
import { LanguageMenu, ThemeToggle } from "@repo/ds/shell";
import { useLanguage } from "../language";

/**
 * The top bar's quick preferences beside the bell: the account's language and this device's theme, the same choices as
 * Settings › Preferences. A language change refreshes the bell and work, which the servers word in that language.
 */
export function TopBarPreferences() {
  const [language, setLanguage, saving] = useLanguage();
  const refreshAttention = useRefreshFusionAttention();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <LanguageMenu
        value={language}
        saving={saving}
        failed={failed}
        onChange={(next) => {
          setFailed(false);
          setLanguage(next).then(
            () => void refreshAttention(),
            () => setFailed(true)
          );
        }}
      />
      <ThemeToggle />
    </>
  );
}
