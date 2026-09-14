export const oasPreviewStorageKey = (id: string) => `oas-preview:${id}`;

export type StoredPreview = {
  document: Record<string, unknown>;
  operations: { path: string; method: string }[];
  title: string;
};
