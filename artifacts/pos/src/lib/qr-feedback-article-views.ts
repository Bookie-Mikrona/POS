export type ArticleDirection = "improved" | "declined" | "unchanged" | "unavailable";
export type ArticleSort = "difference" | "currentAverage" | "sampleSize";
export type ArticleSortOrder = "ascending" | "descending";
export type ArticleViewState = {
  version: 1;
  search: string;
  sort: ArticleSort;
  sortOrder: ArticleSortOrder;
  directions: Record<ArticleDirection, boolean>;
};

export const ARTICLE_DIRECTION_LABELS: Record<ArticleDirection, string> = {
  improved: "Izboljšani",
  declined: "Poslabšani",
  unchanged: "Nespremenjeni",
  unavailable: "Neprimerljivi",
};
export const QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY = "pos.qr-feedback.article-view.v1";
export const QR_FEEDBACK_NAMED_ARTICLE_VIEWS_STORAGE_KEY = "pos.qr-feedback.named-article-views.v1";
const ARTICLE_SORTS = new Set<ArticleSort>(["difference", "currentAverage", "sampleSize"]);
const ARTICLE_SORT_ORDERS = new Set<ArticleSortOrder>(["ascending", "descending"]);
export const DEFAULT_ARTICLE_VIEW: ArticleViewState = {
  version: 1,
  search: "",
  sort: "difference",
  sortOrder: "descending",
  directions: { improved: true, declined: true, unchanged: true, unavailable: true },
};

export function parseStoredArticleView(raw: string | null): ArticleViewState {
  if (raw == null) return DEFAULT_ARTICLE_VIEW;
  try {
    const parsed = JSON.parse(raw) as Partial<ArticleViewState>;
    const directions = parsed.directions as Partial<Record<ArticleDirection, unknown>> | undefined;
    if (
      parsed.version !== 1
      || typeof parsed.search !== "string"
      || typeof parsed.sort !== "string"
      || !ARTICLE_SORTS.has(parsed.sort as ArticleSort)
      || (
        parsed.sortOrder !== undefined
        && (
          typeof parsed.sortOrder !== "string"
          || !ARTICLE_SORT_ORDERS.has(parsed.sortOrder as ArticleSortOrder)
        )
      )
      || directions == null
      || Object.keys(directions).some(
        (direction) => !Object.hasOwn(ARTICLE_DIRECTION_LABELS, direction),
      )
      || Object.keys(ARTICLE_DIRECTION_LABELS).some(
        (direction) => typeof directions[direction as ArticleDirection] !== "boolean",
      )
    ) {
      return DEFAULT_ARTICLE_VIEW;
    }
    return {
      version: 1,
      search: parsed.search,
      sort: parsed.sort as ArticleSort,
      sortOrder: parsed.sortOrder as ArticleSortOrder | undefined ?? "descending",
      directions: {
        improved: directions.improved as boolean,
        declined: directions.declined as boolean,
        unchanged: directions.unchanged as boolean,
        unavailable: directions.unavailable as boolean,
      },
    };
  } catch {
    return DEFAULT_ARTICLE_VIEW;
  }
}

export function readStoredArticleView(): ArticleViewState {
  if (typeof window === "undefined") return DEFAULT_ARTICLE_VIEW;
  try {
    return parseStoredArticleView(window.localStorage.getItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_ARTICLE_VIEW;
  }
}

export type NamedArticleView = { name: string; view: ArticleViewState };
export const normalizeArticleViewName = (name: string) => name.trim().toLocaleLowerCase("sl");

export function parseNamedArticleViews(raw: string | null): NamedArticleView[] {
  try {
    const entries: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(entries)) return [];
    const names = new Set<string>();
    return entries.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object" || !("name" in entry) || !("view" in entry)) return [];
      if (typeof entry.name !== "string" || !entry.name.trim() || entry.name.trim().length > 80) return [];
      const name = entry.name.trim();
      const normalized = normalizeArticleViewName(name);
      const view = parseStoredArticleView(JSON.stringify(entry.view) ?? null);
      // Invalid entries return the shared default; valid default views are fresh objects.
      if (view === DEFAULT_ARTICLE_VIEW || names.has(normalized)) return [];
      names.add(normalized);
      return [{ name, view }];
    });
  } catch {
    return [];
  }
}
