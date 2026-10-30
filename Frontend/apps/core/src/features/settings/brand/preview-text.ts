import type { CompanyLanguage } from "@repo/api";

/**
 * What the Home preview says, in the draft's default language rather than the viewer's: the studio shows the
 * company's people what they will see.
 */
export const HOME_PREVIEW_TEXT: Record<
  CompanyLanguage,
  {
    morning: (name: string) => string;
    home: string;
    core: string;
    performance: string;
    settings: string;
    needsYou: string;
    items: [string, string, string];
    sources: [string, string, string];
    open: string;
    comingUp: string;
    upcoming: [string, string];
    yourTeam: string;
  }
> = {
  en: {
    morning: (name) => `Good morning, ${name}`,
    home: "Home",
    core: "Core HR",
    performance: "Performance",
    settings: "Settings",
    needsYou: "Needs you",
    items: ["Complete your self-assessment", "Approve a goal change", "Welcome two new joiners"],
    sources: ["Performance · due Friday", "Performance", "Core HR · Monday"],
    open: "Open",
    comingUp: "Coming up",
    upcoming: ["1:1 with your manager", "Work anniversary"],
    yourTeam: "Your team",
  },
  fr: {
    morning: (name) => `Bonjour, ${name}`,
    home: "Accueil",
    core: "RH",
    performance: "Performance",
    settings: "Paramètres",
    needsYou: "À faire",
    items: ["Terminez votre auto-évaluation", "Approuvez un changement d'objectif", "Accueillez deux nouveaux arrivants"],
    sources: ["Performance · pour vendredi", "Performance", "RH · lundi"],
    open: "Ouvrir",
    comingUp: "À venir",
    upcoming: ["Entretien avec votre responsable", "Anniversaire d'embauche"],
    yourTeam: "Votre équipe",
  },
  ar: {
    morning: (name) => `صباح الخير، ${name}`,
    home: "الرئيسية",
    core: "الموارد البشرية",
    performance: "الأداء",
    settings: "الإعدادات",
    needsYou: "بانتظارك",
    items: ["أكمل تقييمك الذاتي", "وافق على تغيير هدف", "رحّب بموظفَين جديدين"],
    sources: ["الأداء · قبل الجمعة", "الأداء", "الموارد البشرية · الاثنين"],
    open: "فتح",
    comingUp: "قريبًا",
    upcoming: ["لقاء فردي مع مديرك", "ذكرى الانضمام"],
    yourTeam: "فريقك",
  },
};
