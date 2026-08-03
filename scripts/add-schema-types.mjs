/**
 * Adds missing JSON Schema `type` keywords to OpenAPI documents.
 *
 * Zoho Desk specs describe constraints (maxLength, format, enum, properties)
 * but omit `type`. Renderers that key off `type` — including fumadocs-openapi —
 * then treat such schemas as opaque primitives and drop the whole field tree.
 *
 * Types are inferred structurally; `type` is only ever added, never overwritten,
 * and only at genuine schema positions so example payloads stay untouched.
 *
 * Usage:
 *   node scripts/add-schema-types.mjs oas/SLA.json [more.json ...] [--dry-run]
 */
import fs from 'fs';
import path from 'path';

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

function jsTypeOf(value) {
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

function typeFromValues(values) {
  const types = new Set();
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

/**
 * Harvests observed types from example payloads, as a last resort for schemas
 * carrying no structural hints at all.
 *
 * `values` maps a property name to the types seen for that property, while
 * `elements` maps it to the types seen *inside* it when it holds an array. The
 * two must stay separate: the schema under `items` describes an element, so
 * reusing the property's own type there would label every element an array.
 */
function collectExampleTypes(doc) {
  const values = new Map();
  const elements = new Map();

  function add(map, name, type) {
    if (!type) return;
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(type);
  }

  function recordPayload(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(recordPayload);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      add(values, key, jsTypeOf(child));
      if (Array.isArray(child)) {
        for (const element of child) add(elements, key, jsTypeOf(element));
      }
      recordPayload(child);
    }
  }

  function scan(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(scan);
      return;
    }
    if (node.examples && typeof node.examples === 'object') {
      for (const example of Object.values(node.examples)) {
        const payload =
          example && typeof example === 'object' && 'value' in example
            ? example.value
            : example;
        recordPayload(payload);
      }
    }
    if (node.example !== undefined) recordPayload(node.example);

    for (const [key, child] of Object.entries(node)) {
      if (key === 'example' || key === 'examples') continue;
      scan(child);
    }
  }

  scan(doc);
  return { values, elements };
}

function inferType(schema, context, exampleTypes) {
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

  // Composed schemas take their type from their branches.
  if (schema.allOf || schema.oneOf || schema.anyOf || schema.not) return null;

  if (Array.isArray(schema.enum)) {
    const type = typeFromValues(schema.enum);
    if (type) return type;
  }
  if (schema.const !== undefined) {
    const type = typeFromValues([schema.const]);
    if (type) return type;
  }

  const format = schema.format;
  if (format === 'int32' || format === 'int64') return 'integer';
  if (format === 'float' || format === 'double') return 'number';
  if (STRING_FORMATS.has(format)) return 'string';

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
  ].filter((facet) => typeof facet === 'number');

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
      // Names are matched document-wide, so the evidence may come from an
      // unrelated operation. Scalars are safe to borrow; `array`/`object` are
      // not, because they promise an `items`/`properties` shape this schema
      // never defines and would render as an empty branch.
      if (SCALAR_TYPES.has(type)) return type;
    }
  }

  return null;
}

function setTypeFirst(schema, type) {
  const entries = Object.entries(schema);
  for (const key of Object.keys(schema)) delete schema[key];
  schema.type = type;
  for (const [key, value] of entries) schema[key] = value;
}

function createWalker(exampleTypes, stats) {
  const asValue = (name) => (name ? { name, kind: 'value' } : null);
  const asElement = (context) =>
    context?.name ? { name: context.name, kind: 'element' } : null;

  function walkSchema(schema, context) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;

    if (schema.type === undefined) {
      const type = inferType(schema, context, exampleTypes);
      if (type) {
        setTypeFirst(schema, type);
        const label = Array.isArray(type) ? type.join('|') : type;
        stats.added.set(label, (stats.added.get(label) ?? 0) + 1);
      } else {
        stats.skipped += 1;
      }
    }

    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      walkSchema(child, asValue(key));
    }
    for (const [key, child] of Object.entries(schema.patternProperties ?? {})) {
      walkSchema(child, asValue(key));
    }
    // Reached without a name: `{}` here means "any value", so it stays untyped.
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      walkSchema(schema.additionalProperties, null);
    }
    if (schema.propertyNames && typeof schema.propertyNames === 'object') {
      walkSchema(schema.propertyNames, null);
    }
    if (schema.items) walkSchema(schema.items, asElement(context));
    if (schema.contains) walkSchema(schema.contains, asElement(context));
    if (Array.isArray(schema.prefixItems)) {
      for (const child of schema.prefixItems) walkSchema(child, asElement(context));
    }
    if (schema.not) walkSchema(schema.not, context);

    for (const key of ['allOf', 'oneOf', 'anyOf']) {
      if (Array.isArray(schema[key])) {
        for (const child of schema[key]) walkSchema(child, context);
      }
    }
  }

  function walkContent(content) {
    for (const media of Object.values(content ?? {})) {
      if (media?.schema) walkSchema(media.schema, null);
    }
  }

  function walkParameters(parameters) {
    if (!Array.isArray(parameters)) return;
    for (const parameter of parameters) {
      if (parameter?.schema) walkSchema(parameter.schema, asValue(parameter.name));
      if (parameter?.content) walkContent(parameter.content);
    }
  }

  function walkHeaders(headers) {
    for (const [name, header] of Object.entries(headers ?? {})) {
      if (header?.schema) walkSchema(header.schema, asValue(name));
      if (header?.content) walkContent(header.content);
    }
  }

  function walkOperation(operation) {
    if (!operation || typeof operation !== 'object') return;
    walkParameters(operation.parameters);
    if (operation.requestBody?.content) walkContent(operation.requestBody.content);
    for (const response of Object.values(operation.responses ?? {})) {
      if (response?.content) walkContent(response.content);
      if (response?.headers) walkHeaders(response.headers);
    }
    for (const callback of Object.values(operation.callbacks ?? {})) {
      walkPathItems(callback);
    }
  }

  const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

  function walkPathItems(pathItems) {
    for (const pathItem of Object.values(pathItems ?? {})) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      walkParameters(pathItem.parameters);
      for (const method of METHODS) {
        if (pathItem[method]) walkOperation(pathItem[method]);
      }
    }
  }

  return function walkDocument(doc) {
    walkPathItems(doc.paths);
    walkPathItems(doc.webhooks);

    const components = doc.components ?? {};
    for (const [name, schema] of Object.entries(components.schemas ?? {})) {
      walkSchema(schema, asValue(name));
    }
    for (const body of Object.values(components.requestBodies ?? {})) {
      if (body?.content) walkContent(body.content);
    }
    for (const response of Object.values(components.responses ?? {})) {
      if (response?.content) walkContent(response.content);
      if (response?.headers) walkHeaders(response.headers);
    }
    walkParameters(Object.values(components.parameters ?? {}));
    walkHeaders(components.headers);
    for (const pathItem of Object.values(components.pathItems ?? {})) {
      walkPathItems({ item: pathItem });
    }
  };
}

function processFile(file, dryRun) {
  const raw = fs.readFileSync(file, 'utf8');
  const doc = JSON.parse(raw);
  const exampleTypes = collectExampleTypes(doc);
  const stats = { added: new Map(), skipped: 0 };

  createWalker(exampleTypes, stats)(doc);

  const totalAdded = [...stats.added.values()].reduce((sum, n) => sum + n, 0);
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  const output = JSON.stringify(doc, null, 2) + trailingNewline;

  if (!dryRun && totalAdded > 0) {
    fs.writeFileSync(file, output, 'utf8');
  }

  const breakdown = [...stats.added.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}=${count}`)
    .join(' ');

  console.log(
    `${path.relative(process.cwd(), file)}: +${totalAdded} type(s)` +
      (breakdown ? ` (${breakdown})` : '') +
      (stats.skipped ? `, ${stats.skipped} left untyped` : '') +
      (dryRun ? ' [dry run]' : '')
  );

  return totalAdded;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter((arg) => !arg.startsWith('--'));

if (files.length === 0) {
  console.error('Usage: node scripts/add-schema-types.mjs <file.json> [...] [--dry-run]');
  process.exit(1);
}

let total = 0;
for (const file of files) {
  total += processFile(path.resolve(process.cwd(), file), dryRun);
}
console.log(`\nTotal: ${total} type keyword(s) ${dryRun ? 'would be added' : 'added'}.`);
