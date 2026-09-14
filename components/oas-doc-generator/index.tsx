'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { writePreviewCookies } from '@/lib/oas-preview-cookies-client';
import {
  oasPreviewStorageKey,
  type StoredPreview,
} from '@/lib/oas-preview-storage';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const MAX_SELECTED = 5;

export type OasOperation = {
  id: string;
  path: string;
  method: string;
  summary: string;
  operationId?: string;
};

type MergeStats = {
  rewritten: number;
  sources: { file: string; refs: number }[];
  missing: string[];
  unresolved: string[];
};

type PreviewResponse = {
  id: string;
  title: string;
  previewUrl: string;
  exportUrl: string;
  portableUrl: string;
  document?: Record<string, unknown>;
  operations?: { path: string; method: string }[];
  merge: MergeStats;
  server: { url: string; assumed: boolean };
  patterns: { repaired: number; dropped: number; total: number };
};

function extractOperations(doc: Record<string, unknown>): OasOperation[] {
  const paths = doc.paths;
  if (!paths || typeof paths !== 'object') return [];
  const ops: OasOperation[] = [];
  for (const [path, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (!op || typeof op !== 'object') continue;
      const record = op as Record<string, unknown>;
      const summary =
        (typeof record.summary === 'string' && record.summary) ||
        (typeof record.operationId === 'string' && record.operationId) ||
        `${method.toUpperCase()} ${path}`;
      ops.push({
        id: `${method}:${path}`,
        path,
        method,
        summary,
        operationId: typeof record.operationId === 'string' ? record.operationId : undefined,
      });
    }
  }
  return ops;
}

function validateOasText(text: string): {
  ok: boolean;
  error?: string;
  document?: Record<string, unknown>;
  operations?: OasOperation[];
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: 'Paste or upload an OpenAPI JSON document to begin.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON.',
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'OAS document must be a JSON object.' };
  }
  const doc = parsed as Record<string, unknown>;
  if (!doc.openapi && !doc.swagger) {
    return { ok: false, error: 'Missing "openapi" or "swagger" version field.' };
  }
  if (!doc.paths || typeof doc.paths !== 'object' || Array.isArray(doc.paths)) {
    return { ok: false, error: 'Missing "paths" object.' };
  }
  const operations = extractOperations(doc);
  if (operations.length === 0) {
    return { ok: false, error: 'No operations found under "paths".' };
  }
  return { ok: true, document: doc, operations };
}

/**
 * Restores the interactivity the exported file loses when React is stripped out. The markup keeps
 * Radix's `aria-controls` / `data-state` wiring, so toggling those attributes is enough for the
 * request-sample tabs, response tabs and collapsible schema sections to keep working.
 */
const PORTABLE_BEHAVIOUR_SCRIPT = `
document.addEventListener('click', function (event) {
  var tab = event.target.closest('[role="tab"]');
  if (tab) {
    var list = tab.closest('[role="tablist"]');
    if (!list) return;
    list.querySelectorAll('[role="tab"]').forEach(function (other) {
      var active = other === tab;
      var panel = document.getElementById(other.getAttribute('aria-controls'));
      other.setAttribute('aria-selected', active ? 'true' : 'false');
      other.setAttribute('data-state', active ? 'active' : 'inactive');
      if (!panel) return;
      panel.setAttribute('data-state', active ? 'active' : 'inactive');
      if (active) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    });
    return;
  }
  var toggle = event.target.closest('[aria-expanded]');
  if (!toggle) return;
  var content = document.getElementById(toggle.getAttribute('aria-controls'));
  var open = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
  toggle.setAttribute('data-state', open ? 'closed' : 'open');
  if (!content) return;
  content.setAttribute('data-state', open ? 'closed' : 'open');
  if (open) content.setAttribute('hidden', '');
  else content.removeAttribute('hidden');
});
`.trim();

/** Overrides for the exported file, where no framework is left to drive layout. */
const PORTABLE_EXPORT_CSS = `
[data-oas-export] [class*="animate-fd-accordion"],
[data-oas-export] [class*="animate-fd-collapsible"] {
  animation: none !important;
  height: auto !important;
  overflow: visible !important;
}
[data-oas-export] [role="tabpanel"]:not([hidden]) { display: block; }
[data-oas-export] button[type="submit"] { pointer-events: none; opacity: 0.55; }
/* Its dropdown cannot open without the framework, so let it sit inert instead of flickering. */
[data-oas-export] [role="combobox"] { pointer-events: none; }
/* Keep samples on the light Shiki tokens the preview uses, even if the OS is in dark mode. */
[data-oas-export] {
  color-scheme: light;
}
[data-oas-export] .shiki,
[data-oas-export] .shiki pre {
  background: var(--shiki-light-bg, var(--color-fd-secondary, #f3f4f6)) !important;
  color: var(--shiki-light, inherit) !important;
}
[data-oas-export] .shiki code span {
  color: var(--shiki-light) !important;
  font-style: var(--shiki-light-font-style, inherit);
}
`.trim();

/** Portable CSS fallback when the stylesheet snapshot is incomplete. */
const PORTABLE_FALLBACK_CSS = `
:root {
  --fd-background: #ffffff;
  --fd-foreground: #111827;
  --fd-muted-foreground: #6b7280;
  --fd-card: #ffffff;
  --fd-border: #e5e7eb;
  --fd-primary: #2563eb;
  --fd-primary-foreground: #ffffff;
  --fd-secondary: #f3f4f6;
  --fd-accent: #f3f4f6;
  --fd-ring: #2563eb;
  color-scheme: light;
}
/* Kept on html so the real font class (which also targets html, later in the sheet) still wins. */
html {
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  color-scheme: light;
}
body {
  margin: 0;
  background: var(--fd-background);
  color: var(--fd-foreground);
  line-height: 1.5;
}
`.trim();

async function waitUntil(test: () => boolean, timeout: number, step = 30): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (test()) return true;
    await new Promise((resolve) => window.setTimeout(resolve, step));
  }
  return test();
}

/**
 * Radix tab triggers activate on `mousedown` rather than `click`, so `el.click()` alone selects
 * nothing. Dispatching the whole press sequence drives both tabs and collapsibles.
 */
function pressElement(el: HTMLElement) {
  const view = el.ownerDocument.defaultView;
  if (!view) return;
  el.focus?.();
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
    const Ctor =
      type.startsWith('pointer') && 'PointerEvent' in view ? view.PointerEvent : view.MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view, button: 0 }));
  }
}

/**
 * Presses an element until it reports the state we asked for. Retries matter because the frame may
 * not have hydrated yet, and an event before React attaches its listeners does nothing at all.
 */
async function clickUntil(el: HTMLElement, done: () => boolean, attempts = 12): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (done()) return true;
    pressElement(el);
    if (await waitUntil(done, 200)) return true;
  }
  return done();
}

/**
 * Radix mounts an inactive tab panel's children only while it is selected, so a plain copy of the
 * frame would export empty request samples. Clicking through every tab captures each panel's
 * markup, and expanding the collapsible sections mounts their contents too.
 */
async function collectHiddenContent(doc: Document): Promise<Map<string, string>> {
  const stash = new Map<string, string>();
  // Radix swaps the whole panel element when it mounts, so a held reference goes stale; always
  // look the target up again by id.
  const filled = (id: string | null) =>
    !!id && (doc.getElementById(id)?.innerHTML.trim().length ?? 0) > 0;

  // Expanding a section can reveal further collapsed sections, so keep sweeping until none remain.
  const expandAll = async () => {
    for (let sweep = 0; sweep < 5; sweep += 1) {
      // Only sections, never popup triggers: opening a select or dialog would leave its floating
      // panel stranded in the middle of the exported page.
      const collapsed = [
        ...doc.querySelectorAll<HTMLElement>(
          '[aria-expanded="false"]:not([aria-haspopup]):not([role="combobox"])',
        ),
      ];
      if (collapsed.length === 0) break;
      for (const trigger of collapsed) {
        await clickUntil(trigger, () => trigger.getAttribute('aria-expanded') === 'true');
        await waitUntil(() => filled(trigger.getAttribute('aria-controls')), 1000);
      }
    }
  };

  await expandAll();

  for (const list of doc.querySelectorAll('[role="tablist"]')) {
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls');
      await clickUntil(tab, () => tab.getAttribute('aria-selected') === 'true');
      // Code samples are syntax highlighted asynchronously, so the panel starts out empty.
      await waitUntil(() => filled(panelId), 2000);
      const panel = panelId ? doc.getElementById(panelId) : null;
      if (panel?.innerHTML.trim()) stash.set(panel.id, panel.innerHTML);
    }
    if (selected) await clickUntil(selected, () => selected.getAttribute('aria-selected') === 'true');
  }

  // Panels mounted during the pass above can contain their own collapsed sections.
  await expandAll();

  return stash;
}

/** Serialises every stylesheet the frame actually applied, including ones injected by scripts. */
function collectStyles(doc: Document): string {
  const parts: string[] = [];
  for (const sheet of [...doc.styleSheets]) {
    let rules: string;
    try {
      rules = [...sheet.cssRules]
        // A browser refuses to load a font file into a `file://` page (CORS applies to fonts even
        // then), so downloading one would only produce a failed request. next/font also emits a
        // metric-matched fallback built from local fonts, and that one works offline — keep it.
        // Matched on text because the rules belong to the iframe's realm, where `instanceof` on
        // this window's CSSFontFaceRule is always false.
        .filter((rule) => !(/^@font-face/i.test(rule.cssText) && rule.cssText.includes('url(')))
        .map((rule) => rule.cssText)
        .join('\n');
    } catch {
      // Cross-origin sheet: its rules are unreadable, skip it.
      continue;
    }
    // Asset URLs are relative to the stylesheet (font files sit next to the CSS chunk), and the
    // exported file lives somewhere else entirely, so resolve them all up front.
    const base = sheet.href ?? doc.baseURI;
    parts.push(
      rules.replace(/url\((\s*['"]?)([^'")]+)(['"]?\s*)\)/g, (match, open, value, close) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value)) return match;
        try {
          return `url(${open}${new URL(value, base).href}${close})`;
        } catch {
          return match;
        }
      }),
    );
  }
  return parts.join('\n');
}

async function buildPortableHtml(iframe: HTMLIFrameElement, title: string): Promise<string> {
  const doc = iframe.contentDocument;
  const view = iframe.contentWindow;
  if (!doc || !view) {
    throw new Error('The preview frame is not ready yet. Wait for it to load and try again.');
  }
  if (doc.readyState !== 'complete') {
    await new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  }
  if (isNextNotFoundPage(doc)) {
    throw new Error(
      'The preview page did not load (404). Click Preview again, then download once the rendered documentation appears.',
    );
  }
  // A frame caught mid-navigation would export as an empty shell, which is worse than an error.
  const rendered = await waitUntil(() => !!doc.querySelector('article h2'), 5000);
  if (!rendered) {
    throw new Error('The preview is still rendering. Try the download again in a moment.');
  }

  const stash = await collectHiddenContent(doc);
  const css = collectStyles(doc);
  const root = doc.documentElement.cloneNode(true) as HTMLElement;

  for (const panel of root.querySelectorAll('[role="tabpanel"]')) {
    const markup = stash.get(panel.id);
    if (markup && !panel.innerHTML.trim()) panel.innerHTML = markup;
  }

  root
    .querySelectorAll(
      'script, link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"], nextjs-portal',
    )
    .forEach((el) => el.remove());

  // The file is opened from disk, where root-relative assets (icons, images) cannot resolve.
  const origin = view.location.origin;
  for (const attribute of ['src', 'href'] as const) {
    for (const el of root.querySelectorAll(`[${attribute}^="/"]`)) {
      const value = el.getAttribute(attribute);
      if (value && !value.startsWith('//')) el.setAttribute(attribute, `${origin}${value}`);
    }
  }
  // The playground dialog needs a live server, so drop its trigger rather than ship a dead button.
  root.querySelectorAll('[aria-haspopup="dialog"]').forEach((el) => el.remove());
  // Floating panels only make sense while their owner is open, which nothing here can do.
  root
    .querySelectorAll('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]')
    .forEach((el) => el.remove());

  // next-themes may have left `dark` on <html> if the OS is in dark mode. The published preview
  // stays light unless the user toggles it; the file has no theme provider, so strip that class
  // or Shiki/fumadocs dark tokens take over and the samples go dark-blue.
  root.classList.remove('dark');
  root.style.colorScheme = 'light';

  const head = root.querySelector('head') ?? root.insertBefore(doc.createElement('head'), root.firstChild);
  const colorScheme = doc.createElement('meta');
  colorScheme.setAttribute('name', 'color-scheme');
  colorScheme.setAttribute('content', 'light');
  head.prepend(colorScheme);

  const style = doc.createElement('style');
  style.textContent = [PORTABLE_FALLBACK_CSS, css, PORTABLE_EXPORT_CSS].join('\n');
  head.appendChild(style);

  const titleEl = head.querySelector('title') ?? head.appendChild(doc.createElement('title'));
  titleEl.textContent = title;

  const script = doc.createElement('script');
  script.textContent = PORTABLE_BEHAVIOUR_SCRIPT;
  root.querySelector('body')?.appendChild(script);

  const noscript = doc.createElement('noscript');
  noscript.textContent = '';
  const noscriptStyle = doc.createElement('style');
  noscriptStyle.textContent =
    '[role="tabpanel"][hidden] { display: block !important; } [aria-expanded] + * [hidden] { display: block !important; }';
  noscript.appendChild(noscriptStyle);
  head.appendChild(noscript);

  root.setAttribute('data-oas-export', '');
  root.querySelector('body')?.setAttribute('data-oas-export', '');

  return `<!DOCTYPE html>\n${root.outerHTML}`;
}

function isNextNotFoundPage(doc: Document): boolean {
  const heading = doc.querySelector('h1')?.textContent?.trim();
  if (heading === '404') return true;
  return (
    /This page could not be found/i.test(doc.body?.innerText ?? '') &&
    !doc.querySelector('article h2')
  );
}

function rememberPreview(data: PreviewResponse, fallbackDocument?: Record<string, unknown>) {
  const document = data.document ?? fallbackDocument;
  if (!document) return;
  const stored: StoredPreview = {
    document,
    operations: data.operations ?? [],
    title: data.title,
  };
  try {
    sessionStorage.setItem(oasPreviewStorageKey(data.id), JSON.stringify(stored));
  } catch {
    /* quota or private mode — open-in-new-tab may not be able to re-render */
  }
}

function downloadPortableOas(preview: PreviewResponse) {
  let document = preview.document;
  if (!document) {
    try {
      const raw = sessionStorage.getItem(oasPreviewStorageKey(preview.id));
      if (raw) document = (JSON.parse(raw) as StoredPreview).document;
    } catch {
      /* ignore */
    }
  }
  if (document) {
    const base =
      preview.title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'api';
    downloadBlob(`${base}-portable.json`, JSON.stringify(document, null, 2), 'application/json');
    return;
  }
  window.location.assign(preview.portableUrl);
}

function downloadBlob(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function OasDocGenerator() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [editorText, setEditorText] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [operations, setOperations] = useState<OasOperation[]>([]);
  const [documentObj, setDocumentObj] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // fumadocs-openapi puts the sample/playground column beside the schema only when its
  // own container is at least 56rem wide, which a half-width pane never is. Expanding
  // hands the preview the whole row so it matches the published pages and the download.
  const [expanded, setExpanded] = useState(false);
  // Exporting reads the frame's live DOM, so it must not start while the frame is still loading.
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'oas-preview-ready') setFrameReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const applyParsedText = useCallback((text: string, sourceName?: string | null) => {
    setEditorText(text);
    setFileName(sourceName ?? null);
    setPreview(null);
    setPreviewError(null);
    const result = validateOasText(text);
    if (!result.ok) {
      setParseError(result.error ?? 'Invalid document.');
      setOperations([]);
      setDocumentObj(null);
      setSelectedIds([]);
      return;
    }
    setParseError(null);
    setDocumentObj(result.document!);
    setOperations(result.operations!);
    setSelectedIds((prev) => {
      const stillValid = prev.filter((id) => result.operations!.some((op) => op.id === id));
      if (stillValid.length > 0) return stillValid.slice(0, MAX_SELECTED);
      return result.operations!.slice(0, 1).map((op) => op.id);
    });
  }, []);

  const onEditorChange = (value: string) => {
    setEditorText(value);
    setPreview(null);
    setPreviewError(null);
    // Lightweight live validation without forcing preview
    const result = validateOasText(value);
    if (!result.ok) {
      setParseError(result.error ?? 'Invalid document.');
      setOperations([]);
      setDocumentObj(null);
      return;
    }
    setParseError(null);
    setDocumentObj(result.document!);
    setOperations(result.operations!);
    setSelectedIds((prev) => {
      const stillValid = prev.filter((id) => result.operations!.some((op) => op.id === id));
      if (stillValid.length > 0) return stillValid.slice(0, MAX_SELECTED);
      return result.operations!.slice(0, 1).map((op) => op.id);
    });
  };

  const onUploadClick = () => fileInputRef.current?.click();

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setParseError('Please upload a .json OpenAPI file.');
      return;
    }
    try {
      const text = await file.text();
      applyParsedText(text, file.name);
    } catch {
      setParseError('Could not read the selected file.');
    }
  };

  const toggleOperation = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTED) return prev;
      return [...prev, id];
    });
    setPreview(null);
    setPreviewError(null);
  };

  const selectedOperations = useMemo(
    () => operations.filter((op) => selectedIds.includes(op.id)),
    [operations, selectedIds],
  );

  const runPreview = async () => {
    if (!documentObj) {
      setPreviewError(parseError || 'Fix the OAS document before previewing.');
      return;
    }
    if (selectedOperations.length === 0) {
      setPreviewError('Select at least one operation.');
      return;
    }
    setBusy('preview');
    setPreviewError(null);
    setFrameReady(false);
    try {
      const response = await fetch('/api/oas-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: documentObj,
          operations: selectedOperations.map((op) => ({
            path: op.path,
            method: op.method,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Preview failed (${response.status})`);
      }
      const nextPreview = data as PreviewResponse;
      rememberPreview(nextPreview, documentObj);
      if (nextPreview.document && nextPreview.operations) {
        try {
          await writePreviewCookies(
            nextPreview.id,
            nextPreview.document,
            nextPreview.operations,
          );
        } catch (cookieError) {
          console.warn(cookieError);
        }
      }
      setPreview(nextPreview);
    } catch (error) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : 'Preview failed.');
    } finally {
      setBusy(null);
    }
  };

  const runDownload = async () => {
    if (!preview) {
      setPreviewError('Generate a preview before downloading.');
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe) {
      setPreviewError('The preview frame is not available.');
      return;
    }
    setBusy('download');
    setPreviewError(null);
    try {
      const html = await buildPortableHtml(iframe, preview.title);
      const base =
        preview.title.replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '') ||
        selectedOperations[0]?.operationId ||
        'api-doc';
      downloadBlob(`${base}-api-doc.html`, html, 'text/html;charset=utf-8');
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Download failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="not-prose my-4 flex flex-col gap-4">
      <p className="text-sm text-fd-muted-foreground">
        Paste or upload an OpenAPI JSON document, pick one or more operations (up to{' '}
        {MAX_SELECTED}), then preview how this site renders the API docs. References to companion
        files such as <code>Common.json</code> are merged in automatically from this site&apos;s{' '}
        <code>oas/</code> folder, so split product specs work too. You can download the preview as
        standalone HTML or as the merged portable OAS.
      </p>

      <div
        className={
          expanded
            ? 'flex flex-col-reverse gap-4'
            : 'grid gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]'
        }
      >
        {/* Left pane */}
        <section
          aria-label="OpenAPI editor"
          className="flex min-h-[36rem] flex-col gap-3 rounded-xl border border-fd-border bg-fd-card p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">OpenAPI JSON</h2>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={onFileSelected}
                aria-label="Upload OpenAPI JSON file"
              />
              <button
                type="button"
                onClick={onUploadClick}
                className="rounded-md border border-fd-border bg-fd-secondary px-3 py-1.5 text-xs font-medium hover:bg-fd-accent"
              >
                Upload file
              </button>
            </div>
          </div>

          {fileName ? (
            <p className="text-xs text-fd-muted-foreground">Loaded from: {fileName}</p>
          ) : null}

          <label htmlFor="oas-json-editor" className="sr-only">
            OpenAPI JSON editor
          </label>
          <textarea
            id="oas-json-editor"
            value={editorText}
            onChange={(event) => onEditorChange(event.target.value)}
            spellCheck={false}
            placeholder='{ "openapi": "3.1.0", "info": { "title": "..." }, "paths": { ... } }'
            className="min-h-[16rem] flex-1 resize-y rounded-lg border border-fd-border bg-fd-background p-3 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-fd-ring"
          />

          {parseError ? (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {parseError}
            </p>
          ) : operations.length > 0 ? (
            <p className="text-xs text-fd-muted-foreground">
              Parsed {operations.length} operation{operations.length === 1 ? '' : 's'}.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Operations</h3>
              <span className="text-xs text-fd-muted-foreground">
                {selectedIds.length}/{MAX_SELECTED} selected
              </span>
            </div>
            <div
              role="group"
              aria-label="Select operations to preview"
              className="max-h-48 overflow-auto rounded-lg border border-fd-border"
            >
              {operations.length === 0 ? (
                <p className="p-3 text-xs text-fd-muted-foreground">
                  Operations appear here after a valid OAS is loaded.
                </p>
              ) : (
                <ul className="divide-y divide-fd-border">
                  {operations.map((op) => {
                    const checked = selectedIds.includes(op.id);
                    const disabled = !checked && selectedIds.length >= MAX_SELECTED;
                    return (
                      <li key={op.id}>
                        <label
                          className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-xs hover:bg-fd-accent/60 ${
                            disabled ? 'opacity-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleOperation(op.id)}
                          />
                          <span className="min-w-0">
                            <span className="font-mono font-semibold uppercase text-fd-primary">
                              {op.method}
                            </span>{' '}
                            <span className="font-mono break-all">{op.path}</span>
                            <span className="mt-0.5 block text-fd-muted-foreground">{op.summary}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={runPreview}
              disabled={busy !== null || !documentObj || selectedIds.length === 0}
              className="rounded-md bg-fd-primary px-3 py-2 text-xs font-semibold text-fd-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'preview' ? 'Rendering…' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={runDownload}
              disabled={busy !== null || !preview || !frameReady}
              className="rounded-md border border-fd-border bg-fd-secondary px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'download' ? 'Preparing…' : 'Download HTML'}
            </button>
            {preview ? (
              <button
                type="button"
                onClick={() => downloadPortableOas(preview)}
                className="rounded-md border border-fd-border bg-fd-secondary px-3 py-2 text-xs font-semibold hover:bg-fd-accent"
              >
                Download portable OAS
              </button>
            ) : null}
          </div>
        </section>

        {/* Right pane */}
        <section
          aria-label="API documentation preview"
          className="flex min-h-[36rem] flex-col gap-3 rounded-xl border border-fd-border bg-fd-card p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Rendered documentation</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-pressed={expanded}
                className="rounded-md border border-fd-border bg-fd-secondary px-2 py-1 text-xs font-medium hover:bg-fd-accent"
              >
                {expanded ? 'Side-by-side view' : 'Full-width view'}
              </button>
              {preview ? (
                <a
                  href={preview.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-fd-primary underline-offset-2 hover:underline"
                >
                  Open in new tab
                </a>
              ) : null}
            </div>
          </div>

          {previewError ? (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {previewError}
            </p>
          ) : null}

          {preview && preview.patterns.repaired + preview.patterns.dropped > 0 ? (
            <p className="rounded-md border border-fd-border bg-fd-secondary px-3 py-2 text-xs text-fd-muted-foreground">
              {preview.patterns.repaired > 0
                ? `${preview.patterns.repaired} regex pattern(s) were rewritten for JavaScript`
                : 'Adjusted regex patterns'}
              {preview.patterns.dropped > 0
                ? `, and ${preview.patterns.dropped} that JavaScript cannot express were removed`
                : ''}
              . Java-only constructs such as <code>\P{'{'}InBasicLatin{'}'}</code> otherwise crash the
              renderer.
            </p>
          ) : null}

          {preview?.server.assumed ? (
            <p className="rounded-md border border-fd-border bg-fd-secondary px-3 py-2 text-xs text-fd-muted-foreground">
              The document has no absolute <code>servers</code> entry, so request samples use{' '}
              <code>{preview.server.url}</code>.
            </p>
          ) : null}

          {preview && preview.merge.rewritten > 0 ? (
            <p className="rounded-md border border-fd-border bg-fd-secondary px-3 py-2 text-xs text-fd-muted-foreground">
              Inlined {preview.merge.rewritten} cross-file reference
              {preview.merge.rewritten === 1 ? '' : 's'} from{' '}
              {preview.merge.sources.map((source) => `${source.file} (${source.refs})`).join(', ')}.
              Download portable OAS gives you that merged document.
            </p>
          ) : null}

          {!expanded && preview ? (
            <p className="text-xs text-fd-muted-foreground">
              This pane is too narrow for the two-column API layout. Switch to full-width view,
              open it in a new tab, or download the HTML to see the published layout.
            </p>
          ) : null}

          <div
            className={`relative flex-1 overflow-hidden rounded-lg border border-fd-border bg-fd-background ${
              expanded ? 'min-h-[45rem]' : 'min-h-[32rem]'
            }`}
          >
            {busy === 'preview' ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-fd-background/80 text-sm text-fd-muted-foreground">
                Rendering with fumadocs-openapi…
              </div>
            ) : null}
            {preview ? (
              <iframe
                ref={iframeRef}
                key={preview.id}
                onLoad={(event) => {
                  const doc = event.currentTarget.contentDocument;
                  setFrameReady(!!doc && !isNextNotFoundPage(doc) && !!doc.querySelector('article h2'));
                }}
                title="OAS documentation preview"
                src={preview.previewUrl}
                className={`h-full w-full border-0 ${expanded ? 'min-h-[45rem]' : 'min-h-[32rem]'}`}
              />
            ) : (
              <div className="flex h-full min-h-[32rem] items-center justify-center p-6 text-center text-sm text-fd-muted-foreground">
                The live preview appears here after you click Preview.
                <br />
                It uses the same rendering path as the published API reference pages.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
