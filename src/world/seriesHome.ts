/** Home book of a series-scoped reference, for badges and edit links. */
export interface SeriesHomeRef {
  projectId: string;
  title: string;
  bookName: string | null;
}

export function seriesBookLabel(home: Pick<SeriesHomeRef, "title" | "bookName">): string {
  const book = home.bookName?.trim();
  return book || home.title;
}

export function seriesRecordHref(projectId: string, recordId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
}
