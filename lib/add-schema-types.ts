/**
 * Adds missing JSON Schema `type` keywords to OpenAPI documents.
 * Shared by the CLI script workflow and the OAS preview API.
 */

const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

const STRING_FORMATS = new Set([
  'binary',
  'byte',
  'date',
  'date-time',
  'duration',
  'email',
  'hostname',
  'idn-email',
  'ipv4',
  'ipv6',
  'iri',
  'password',
  'regex',
  'time',
  'uri',
  'uri-reference',
  'uuid',
]);

export type AddSchemaTypesStats = {
  added: Map<string, number>;
  skipped: number;
};

type ExampleTypes = {
  values: Map<string, Set<string>>;
  elements: Map<string, Set<string>>;
};

type SchemaContext = { name: string; kind: 'value' | 'element' } | null;

function jsTypeOf(value: unknown): string | null {
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'string':
      return 'string';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    case 'object':
      return value === null ? null : 'object';
    default:
      return null;
  }
}

function typeFromValues(values: unknown[]): string | string[] | null {
  const types = new Set<string>();
  let nullable = false;

  for (const value of values) {
    if (value === null) {
      nullable = true;
      continue;
    }
    const type = jsTypeOf(value);
    if (type) types.add(type);
  }

  if (types.has('integer') && types.has('number')) types.delete('integer');
  if (types.size !== 1) return null;

  const type = [...types][0];
  return nullable ? [type, 'null'] : type;
}

function collectExampleTypes(doc: unknown): ExampleTypes {
  const values = new Map<string, Set<string>>();
  const elements = new Map<string, Set<string>>();

  function add(map: Map<string, Set<string>>, name: string, type: string | null) {
    if (!type) return;
    if (!map.has(name)) map.set(name, new Set());
    map.get(name)!.add(type);
  }

  function recordPayload(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(recordPayload);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      add(values, key, jsTypeOf(child));
      if (Array.isArray(child)) {
        for (const element of child) add(elements, key, jsTypeOf(element));
      }
      recordPayload(child);
    }
  }

  function scan(node: unknown) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(scan);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.examples && typeof obj.examples === 'object') {
      for (const example of Object.values(obj.examples as Record<string, unknown>)) {
        const payload =
          example && typeof example === 'object' && 'value' in example
            ? (example as { value: unknown }).value
            : example;
        recordPayload(payload);
      }
    }
    if (obj.example !== undefined) recordPayload(obj.example);

    for (const [key, child] of Object.entries(obj)) {
      if (key === 'example' || key === 'examples') continue;
      scan(child);
    }
  }

  scan(doc);
  return { values, elements };
}

function inferType(
  schema: Record<string, unknown>,
  context: SchemaContext,
  exampleTypes: ExampleTypes,
): string | string[] | null {
  if (schema.$ref) return null;

  const isObject =
    schema.properties !== undefined ||
    schema.patternProperties !== undefined ||
    schema.additionalProperties !== undefined ||
    schema.propertyNames !== undefined ||
    schema.required !== undefined ||
    schema.maxProperties !== undefined ||
    schema.minProperties !== undefined;
  if (isObject) return 'object';

  const isArray =
    schema.items !== undefined ||
    schema.prefixItems !== undefined ||
    schema.maxItems !== undefined ||
    schema.minItems !== undefined ||
    schema.uniqueItems !== undefined ||
    schema.contains !== undefined;
  if (isArray) return 'array';

  if (schema.allOf || schema.oneOf || schema.anyOf || schema.not) return null;

  if (Array.isArray(schema.enum)) {
    const type = typeFromValues(schema.enum);
    if (type) return type;
  }
  if (schema.const !== undefined) {
    const type = typeFromValues([schema.const]);
    if (type) return type;
  }

  const format = schema.format as string | undefined;
  if (format === 'int32' || format === 'int64') return 'integer';
  if (format === 'float' || format === 'double') return 'number';
  if (format && STRING_FORMATS.has(format)) return 'string';

  if (
    schema.maxLength !== undefined ||
    schema.minLength !== undefined ||
    schema.pattern !== undefined
  ) {
    return 'string';
  }

  const numericFacets = [
    schema.maximum,
    schema.minimum,
    schema.exclusiveMaximum,
    schema.exclusiveMinimum,
    schema.multipleOf,
  ].filter((facet) => typeof facet === 'number') as number[];

  if (numericFacets.length > 0) {
    const fractional =
      numericFacets.some((facet) => !Number.isInteger(facet)) ||
      (typeof schema.default === 'number' && !Number.isInteger(schema.default));
    return fractional ? 'number' : 'integer';
  }

  if (schema.default !== undefined) {
    const type = typeFromValues([schema.default]);
    if (type) return type;
  }

  if (context?.name) {
    const observed =
      context.kind === 'element'
        ? exampleTypes.elements.get(context.name)
        : exampleTypes.values.get(context.name);
    if (observed && observed.size === 1) {
      const [type] = [...observed];
      if (SCALAR_TYPES.has(type)) return type;
    }
  }

  return null;
}

function setTypeFirst(schema: Record<string, unknown>, type: string | string[]) {
  const entries = Object.entries(schema);
  for (const key of Object.keys(schema)) delete schema[key];
  schema.type = type;
  for (const [key, value] of entries) schema[key] = value;
}

function createWalker(exampleTypes: ExampleTypes, stats: AddSchemaTypesStats) {
  const asValue = (name: string | null | undefined): SchemaContext =>
    name ? { name, kind: 'value' } : null;
  const asElement = (context: SchemaContext): SchemaContext =>
    context?.name ? { name: context.name, kind: 'element' } : null;

  function walkSchema(schema: unknown, context: SchemaContext) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
    const s = schema as Record<string, unknown>;

    if (s.type === undefined) {
      const type = inferType(s, context, exampleTypes);
      if (type) {
        setTypeFirst(s, type);
        const label = Array.isArray(type) ? type.join('|') : type;
        stats.added.set(label, (stats.added.get(label) ?? 0) + 1);
      } else {
        stats.skipped += 1;
      }
    }

    for (const [key, child] of Object.entries((s.properties as Record<string, unknown>) ?? {})) {
      walkSchema(child, asValue(key));
    }
    for (const [key, child] of Object.entries(
      (s.patternProperties as Record<string, unknown>) ?? {},
    )) {
      walkSchema(child, asValue(key));
    }
    if (s.additionalProperties && typeof s.additionalProperties === 'object') {
      walkSchema(s.additionalProperties, null);
    }
    if (s.propertyNames && typeof s.propertyNames === 'object') {
      walkSchema(s.propertyNames, null);
    }
    if (s.items) walkSchema(s.items, asElement(context));
    if (s.contains) walkSchema(s.contains, asElement(context));
    if (Array.isArray(s.prefixItems)) {
      for (const child of s.prefixItems) walkSchema(child, asElement(context));
    }
    if (s.not) walkSchema(s.not, context);

    for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
      if (Array.isArray(s[key])) {
        for (const child of s[key] as unknown[]) walkSchema(child, context);
      }
    }
  }

  function walkContent(content: unknown) {
    for (const media of Object.values((content as Record<string, unknown>) ?? {})) {
      const m = media as { schema?: unknown } | null;
      if (m?.schema) walkSchema(m.schema, null);
    }
  }

  function walkParameters(parameters: unknown) {
    if (!Array.isArray(parameters)) return;
    for (const parameter of parameters) {
      const p = parameter as { schema?: unknown; content?: unknown; name?: string };
      if (p?.schema) walkSchema(p.schema, asValue(p.name));
      if (p?.content) walkContent(p.content);
    }
  }

  function walkHeaders(headers: unknown) {
    for (const [name, header] of Object.entries((headers as Record<string, unknown>) ?? {})) {
      const h = header as { schema?: unknown; content?: unknown };
      if (h?.schema) walkSchema(h.schema, asValue(name));
      if (h?.content) walkContent(h.content);
    }
  }

  function walkOperation(operation: unknown) {
    if (!operation || typeof operation !== 'object') return;
    const op = operation as Record<string, unknown>;
    walkParameters(op.parameters);
    const requestBody = op.requestBody as { content?: unknown } | undefined;
    if (requestBody?.content) walkContent(requestBody.content);
    for (const response of Object.values((op.responses as Record<string, unknown>) ?? {})) {
      const r = response as { content?: unknown; headers?: unknown };
      if (r?.content) walkContent(r.content);
      if (r?.headers) walkHeaders(r.headers);
    }
    for (const callback of Object.values((op.callbacks as Record<string, unknown>) ?? {})) {
      walkPathItems(callback);
    }
  }

  const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

  function walkPathItems(pathItems: unknown) {
    for (const pathItem of Object.values((pathItems as Record<string, unknown>) ?? {})) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      const item = pathItem as Record<string, unknown>;
      walkParameters(item.parameters);
      for (const method of METHODS) {
        if (item[method]) walkOperation(item[method]);
      }
    }
  }

  return function walkDocument(doc: Record<string, unknown>) {
    walkPathItems(doc.paths);
    walkPathItems(doc.webhooks);

    const components = (doc.components as Record<string, unknown>) ?? {};
    for (const [name, schema] of Object.entries(
      (components.schemas as Record<string, unknown>) ?? {},
    )) {
      walkSchema(schema, asValue(name));
    }
    for (const body of Object.values(
      (components.requestBodies as Record<string, unknown>) ?? {},
    )) {
      const b = body as { content?: unknown };
      if (b?.content) walkContent(b.content);
    }
    for (const response of Object.values(
      (components.responses as Record<string, unknown>) ?? {},
    )) {
      const r = response as { content?: unknown; headers?: unknown };
      if (r?.content) walkContent(r.content);
      if (r?.headers) walkHeaders(r.headers);
    }
    walkParameters(Object.values((components.parameters as Record<string, unknown>) ?? {}));
    walkHeaders(components.headers);
    for (const pathItem of Object.values(
      (components.pathItems as Record<string, unknown>) ?? {},
    )) {
      walkPathItems({ item: pathItem });
    }
  };
}

/** Mutates a deep-cloned document is preferred — pass a clone if you need the original intact. */
export function addSchemaTypes(doc: Record<string, unknown>): AddSchemaTypesStats {
  const stats: AddSchemaTypesStats = { added: new Map(), skipped: 0 };
  const exampleTypes = collectExampleTypes(doc);
  createWalker(exampleTypes, stats)(doc);
  return stats;
}

export function cloneAndAddSchemaTypes<T>(doc: T): { document: T; stats: AddSchemaTypesStats } {
  const document = structuredClone(doc);
  const stats = addSchemaTypes(document as Record<string, unknown>);
  return { document, stats };
}
