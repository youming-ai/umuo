# Error Monitoring and Sentry Integration

## Overview

This document explains the error monitoring system implemented in the Yabaii API using Sentry for production error tracking and performance monitoring.

## Architecture

### Error Handling Flow

```
Request → Security Middleware → Route Handler → Error Handler → Sentry → Response
```

1. **Request Processing**: Request passes through security middleware and validation
2. **Route Handling**: Business logic executes, potentially throwing errors
3. **Error Capture**: Errors are caught by the global error handler
4. **Sentry Integration**: Errors are sent to Sentry with context
5. **Response**: User receives appropriate error response

### Sentry Integration Features

- **Error Tracking**: Automatic capture of unhandled exceptions
- **Performance Monitoring**: Request tracing and performance metrics
- **User Context**: User information attached to errors
- **Breadcrumbs**: Request flow tracking for debugging
- **Release Tracking**: Version-aware error monitoring
- **Environment Separation**: Different environments isolated

## Configuration

### Environment Variables

```bash
# Sentry Configuration
SENTRY_DSN=https://your-sentry-dsn-here
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
```

### Sampling Rates

- **Traces Sample Rate**: 10% of requests are traced for performance monitoring
- **Profiles Sample Rate**: 10% of requests are profiled for detailed performance data
- **Error Sample Rate**: 100% of errors are captured (configurable)

## Error Types and Handling

### Custom Error Classes

```typescript
// Validation errors (400)
new ValidationError("Invalid input data", validationErrors, context)

// Authentication errors (401)
new AuthenticationError("Invalid credentials")

// Authorization errors (403)
new AuthorizationError("Access denied")

// Not found errors (404)
new NotFoundError("Resource not found")

// Database errors (500)
new DatabaseError("Database connection failed", { query, params })

// External service errors (502)
new ExternalServiceError("External API unavailable", { service, endpoint })
```

### Error Severity Levels

- **Fatal**: Server errors 503+ (service unavailable)
- **Error**: Server errors 500-502 (internal server errors)
- **Warning**: Rate limiting (429)
- **Info**: Authentication/authorization errors (401/403)
- **Debug**: Other client errors (4xx)

## Sentry Features

### 1. Error Context

**Automatic Context**:
- Request method, path, and headers
- User IP address and user agent
- Request ID for correlation
- Environment and release information

**Manual Context**:
```typescript
const error = new DatabaseError("Query failed", {
  query: "SELECT * FROM products",
  params: { id: productId },
  userId: currentUser.id,
});
```

### 2. User Tracking

```typescript
// Update user context after authentication
updateUserContext({
  id: user.id,
  email: user.email,
  subscription: user.subscription.tier,
  tier: user.subscription.tier,
});

// Clear user context on logout
clearUserContext();
```

### 3. Performance Monitoring

```typescript
// Automatic transaction tracking
app.use('*', async (c, next) => {
  const transaction = performance.startTransaction(
    `${c.req.method} ${c.req.path}`,
    'http.server'
  );

  try {
    await next();
    performance.finishTransaction(transaction, {
      code: c.res.status as Sentry.SpanStatus,
    });
  } catch (error) {
    performance.finishTransaction(transaction, {
      code: 'internal_error' as Sentry.SpanStatus,
    });
    throw error;
  }
});
```

### 4. Breadcrumbs

```typescript
// Add breadcrumbs for debugging
addBreadcrumb('User authenticated', 'auth', 'info', { userId });
addBreadcrumb('Database query executed', 'database', 'debug', { query, duration });
addBreadcrumb('External API call', 'http', 'warning', { url, status });
```

## Error Filtering

### Development Environment

- Validation errors are filtered out
- Stack traces are included in responses
- Verbose logging enabled

### Production Environment

- All server errors (5xx) are sent to Sentry
- Critical client errors (401, 403, 429) are sent to Sentry
- Other client errors (4xx) are logged locally only
- Stack traces are not exposed in responses

### Error Filtering Logic

```typescript
function shouldSendToSentry(error: AppError): boolean {
  if (error.status && error.status < 500) {
    const criticalClientErrors = [401, 403, 429];
    return criticalClientErrors.includes(error.status);
  }
  return true; // All server errors
}
```

## Response Format

### Standard Error Response

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/v1/products/123",
  "requestId": "uuid-for-request-tracking"
}
```

### Production Error Response (with Sentry)

```json
{
  "success": false,
  "error": "Internal Server Error",
  "code": "INTERNAL_ERROR",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/v1/products/123",
  "requestId": "uuid-for-request-tracking",
  "errorId": "sentry-event-id-for-tracking"
}
```

### Development Error Response

```json
{
  "success": false,
  "error": "Database connection failed",
  "code": "DATABASE_ERROR",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/v1/products/123",
  "requestId": "uuid-for-request-tracking",
  "details": {
    "query": "SELECT * FROM products",
    "params": { "id": "123" }
  },
  "stack": "Error: Database connection failed\n    at Object.query..."
}
```

## Monitoring and Alerting

### Sentry Dashboard

1. **Error Overview**: Real-time error monitoring
2. **Performance**: Request tracing and performance metrics
3. **Release Tracking**: Error rates by release version
4. **User Impact**: Affected users and session impact
5. **Environment**: Separate environments for different deployments

### Alerting Rules

1. **Critical Errors**: Server errors (5xx) > 10 per minute
2. **Error Spikes**: Error rate increase > 50% over baseline
3. **Performance Issues**: P95 response time > 2 seconds
4. **Authentication Issues**: 401 errors > 100 per hour

### Health Check Integration

```bash
curl https://api.yabaii.day/health
```

Response includes Sentry status:
```json
{
  "status": "ok",
  "services": {
    "sentry": {
      "status": "enabled",
      "configured": true,
      "environment": "production",
      "release": "1.0.0"
    }
  },
  "performance": {
    "monitoring": true,
    "tracesSampleRate": 0.1,
    "profilesSampleRate": 0.1
  }
}
```

## Best Practices

### 1. Error Creation

```typescript
// Good: Include context and relevant data
throw new DatabaseError("Product lookup failed", {
  productId,
  query: "SELECT * FROM products WHERE id = $1",
  userId: currentUser?.id,
});

// Bad: Generic error without context
throw new Error("Something went wrong");
```

### 2. Error Handling

```typescript
// Good: Handle specific errors appropriately
try {
  const product = await productService.findById(id);
  return c.json({ success: true, data: product });
} catch (error) {
  if (error instanceof NotFoundError) {
    return c.json({ success: false, error: "Product not found" }, 404);
  }
  if (error instanceof DatabaseError) {
    logger.error("Database error in product lookup", error);
    throw error; // Re-throw to be caught by global handler
  }
  throw error;
}
```

### 3. Context Addition

```typescript
// Good: Add breadcrumbs for important events
addBreadcrumb("Product search initiated", "search", "info", {
  query: searchQuery,
  filters: appliedFilters,
  userId: currentUser?.id,
});

// Good: Set user context when available
if (currentUser) {
  updateUserContext({
    id: currentUser.id,
    email: currentUser.email,
    subscription: currentUser.subscription.tier,
  });
}
```

### 4. Performance Monitoring

```typescript
// Good: Add custom spans for expensive operations
const dbSpan = performance.setSpan("database.query", "Product lookup");
try {
  const result = await database.query(query);
  return result;
} finally {
  dbSpan.finish();
}
```

## Troubleshooting

### Common Issues

1. **Sentry Not Capturing Errors**
   - Check SENTRY_DSN is correctly configured
   - Verify Sentry initialization is called early
   - Check network connectivity to Sentry

2. **Too Many Errors in Sentry**
   - Adjust sampling rates in configuration
   - Review error filtering logic
   - Implement better error handling in code

3. **Performance Overhead**
   - Reduce sampling rates for traces and profiles
   - Review breadcrumb frequency
   - Optimize custom spans

### Debugging Sentry Integration

```typescript
// Check Sentry health
import { checkSentryHealth } from '@/config/sentry';

const health = checkSentryHealth();
console.log('Sentry Health:', health);

// Check configuration
import { getSentryMonitoringInfo } from '@/config/sentry';

const info = getSentryMonitoringInfo();
console.log('Sentry Config:', info);
```

## Security Considerations

### Data Privacy

- **PII Filtering**: Sensitive data is automatically filtered
- **User Context**: Only non-sensitive user information is sent
- **Request Data**: Headers and bodies are filtered for sensitive information

### Access Control

- **API Keys**: Sentry access requires proper authentication
- **Environment Separation**: Each environment has separate Sentry projects
- **Data Retention**: Configure appropriate data retention policies

### Configuration Security

```bash
# Use environment variables for sensitive data
SENTRY_DSN=https://your-dsn@sentry.io/project-id

# Don't hardcode DSN in code
# Don't commit DSN to version control
# Use different DSNs for different environments
```

## Testing

### Error Testing

```typescript
// Test error handling
import { ValidationError } from '@/middleware/errorHandler';

it('should capture validation errors in Sentry', async () => {
  const error = new ValidationError("Invalid input", { field: "email" });

  // This should be captured by Sentry
  expect(() => { throw error; }).toThrow();
});
```

### Mocking Sentry

```typescript
// Mock Sentry for testing
vi.mock('@sentry/bun', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
```

## Integration Examples

### Custom Error Class

```typescript
export class ProductSearchError extends Error {
  status = 500;
  code = 'PRODUCT_SEARCH_ERROR';

  constructor(message: string, public searchQuery: string, public filters?: any) {
    super(message);
    this.name = 'ProductSearchError';

    this.context = {
      searchQuery,
      filters,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### Service Integration

```typescript
export class ProductService {
  async searchProducts(query: string) {
    try {
      addBreadcrumb("Product search started", "product", "info", { query });

      const results = await this.performSearch(query);

      addBreadcrumb("Product search completed", "product", "info", {
        resultCount: results.length
      });

      return results;
    } catch (error) {
      addBreadcrumb("Product search failed", "product", "error", {
        query,
        error: error.message
      });

      throw new ProductSearchError("Failed to search products", query, {
        error: error.message,
      });
    }
  }
}
```

This comprehensive error monitoring system provides real-time visibility into application health, performance issues, and user experience problems, enabling quick identification and resolution of issues in production.