"use client";

import { createContext, useContext, useMemo } from "react";

import type { PublicAppSettings } from "@/lib/app-settings-types";
import { DEFAULT_APP_SETTINGS } from "@/lib/app-settings-validation.mjs";

const BrandingContext = createContext<PublicAppSettings>(DEFAULT_APP_SETTINGS);

export function BrandingProvider({
  value,
  children,
}: {
  value: PublicAppSettings;
  children: React.ReactNode;
}) {
  const memoized = useMemo(
    () => ({
      appName: value.appName,
      appDescription: value.appDescription,
      schoolName: value.schoolName,
      participantInfo: value.participantInfo,
      colorPalette: value.colorPalette,
      hasLogo: value.hasLogo,
      hasLetterhead: value.hasLetterhead,
      revision: value.revision,
    }),
    [
      value.appName,
      value.appDescription,
      value.schoolName,
      value.participantInfo,
      value.colorPalette,
      value.hasLogo,
      value.hasLetterhead,
      value.revision,
    ],
  );
  return <BrandingContext.Provider value={memoized}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
