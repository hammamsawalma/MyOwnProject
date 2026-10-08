/**
 * Arabic number-noun agreement driven by Intl.PluralRules("ar"):
 * 1 "يوم واحد", 2 "يومان", 3-10 "7 أيام", 11-99 "11 يومًا", 100+ "100 يوم".
 * The dual changes with grammatical case ("يومان" vs "لمدة يومين"), so callers
 * after a preposition or in a construct (صلاحية، لمدة) pass `oblique: true`.
 */

export interface ArabicNounForms {
  one: string;
  two: string;
  twoOblique: string;
  few: string;
  many: string;
  other: string;
}

export const AR_NOUNS = {
  day: { one: "يوم واحد", two: "يومان", twoOblique: "يومين", few: "أيام", many: "يومًا", other: "يوم" },
  minute: {
    one: "دقيقة واحدة",
    two: "دقيقتان",
    twoOblique: "دقيقتين",
    few: "دقائق",
    many: "دقيقة",
    other: "دقيقة",
  },
  project: {
    one: "مشروع واحد",
    two: "مشروعان",
    twoOblique: "مشروعين",
    few: "مشاريع",
    many: "مشروعًا",
    other: "مشروع",
  },
  client: { one: "عميل واحد", two: "عميلان", twoOblique: "عميلين", few: "عملاء", many: "عميلًا", other: "عميل" },
  entry: { one: "قيد واحد", two: "قيدان", twoOblique: "قيدين", few: "قيود", many: "قيدًا", other: "قيد" },
} satisfies Record<string, ArabicNounForms>;

const rules = new Intl.PluralRules("ar");

export function arCount(n: number, forms: ArabicNounForms, options: { oblique?: boolean } = {}): string {
  switch (rules.select(n)) {
    case "one":
      return forms.one;
    case "two":
      return options.oblique ? forms.twoOblique : forms.two;
    case "few":
      return `${n} ${forms.few}`;
    case "many":
      return `${n} ${forms.many}`;
    default:
      return `${n} ${forms.other}`;
  }
}

/** English counterpart: "1 day", "7 days". */
export function enCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
