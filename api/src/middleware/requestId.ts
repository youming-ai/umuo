/**
 * Request ID middleware
 * Generates unique request IDs for tracing and debugging
 */

import { Context, Next } from 'hono';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate and set request ID
 */
export const requestId = async (c: Context, next: Next) => {
  // Check if request ID already exists in headers
  const existingRequestId = c.req.header('X-Request-ID') ||
                          c.req.header('x-request-id') ||
                          c.req.header('request-id');

  const requestId = existingRequestId || uuidv4();

  // Set request ID in context and headers
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);

  await next();
};

export default requestId;