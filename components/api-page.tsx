import { openapi } from '@/lib/openapi';
import { createAPIPage } from 'fumadocs-openapi/ui';
import client from './api-page.client';

export const APIPage = createAPIPage(openapi, {
  client,
  // Suppresses the "TypeScript Definitions" panel under Response Body. Returning
  // undefined is required: `false` is falsy, so fumadocs-openapi/ui would fall
  // back to its built-in generator and render the panel anyway.
  generateTypeScriptSchema: () => undefined,
});
