// Russian -> English dictionary for admin panel strings that are not part of the
// structured `translations` map in src/lib/i18n.tsx.
// Keys are the exact Russian source strings used in the JSX.
import { alertsDict } from "./alerts";
import { contentDict } from "./content";
import { usersDict } from "./users";
import { statsDict } from "./stats";
import { settingsDict } from "./settings";

export const adminRuEn: Record<string, string> = {
  ...alertsDict,
  ...contentDict,
  ...usersDict,
  ...statsDict,
  ...settingsDict,
};
