/** A UI string in both supported languages (Arabic first). */
export type Localized = { ar: string; en: string };

export type Locale = keyof Localized;
