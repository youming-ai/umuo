# Security Documentation

## Overview

This document outlines the security measures implemented in the Yabaii API to protect against common web security threats and ensure secure operation in production environments.

## Security Features

### 1. CORS (Cross-Origin Resource Sharing)

**Implementation**: Environment-based CORS configuration
- **Development**: Allows localhost origins (3000, 8081, 19006) and production domains
- **Staging**: Allows staging domains and localhost
- **Production**: Strict origin checking for approved domains only

**Configuration**:
```env
ALLOWED_ORIGINS=http://localhost:8081,https://yabaii.day,https://www.yabaii.day,https://app.yabaii.day
```

### 2. Security Headers

**Implemented Headers**:
- `X-Content-Type-Options: nosniff` - Prevents MIME-type sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - XSS protection
- `Referrer-Policy: strict-origin-when-cross-origin` - Controls referrer information
- `Content-Security-Policy` - CSP headers (production only)
- `Permissions-Policy` - Controls browser feature access
- `Server: Yabaii-API` - Hides server information
- `X-Powered-By: Yabaii` - Custom powered-by header

### 3. Rate Limiting

**Implementation**: Redis-based distributed rate limiting

**Rate Limits by Endpoint**:
- **General API**: 1000 requests per 15 minutes
- **Authentication**: 10 requests per 15 minutes
- **Search**: 60 requests per minute
- **Price Tracking**: 30 requests per minute
- **External API**: 100 requests per minute

**Rate Limit Headers**:
- `X-Rate-Limit-Limit`: Maximum requests allowed
- `X-Rate-Limit-Remaining`: Remaining requests in window
- `X-Rate-Limit-Reset`: Time when rate limit window resets
- `Retry-After`: Seconds to wait before retrying (when rate limited)

### 4. JWT Authentication

**Implementation**: Secure JWT tokens with proper algorithms

**Features**:
- **Algorithm**: HS256 (configurable)
- **Access Token**: 7 days expiry
- **Refresh Token**: 30 days expiry
- **Token Rotation**: Refresh token generates new access tokens
- **Secure Headers**: Proper token validation and error handling

### 5. Request Size Limiting

**Limits**:
- **General Requests**: 10MB maximum
- **File Uploads**: 5MB maximum
- **URL Length**: 2048 characters maximum

### 6. API Key Authentication

**Implementation**: Header-based API key authentication for external access

**Configuration**:
```env
VALID_API_KEYS=key1,key2,key3
X-API-Key: your-api-key-here
```

### 7. Request Logging and Monitoring

**Features**:
- Request ID tracking for debugging
- Request/response logging with configurable verbosity
- Slow request detection (>1 second)
- Error and suspicious activity logging
- IP address and user agent tracking

**Configuration**:
```env
LOG_LEVEL=info
LOG_REQUESTS=true
LOG_RESPONSES=false
LOG_HEADERS=false
LOG_BODY=false  # Disabled for security in production
```

## Environment-Specific Security

### Development Environment
- **CORS**: Permissive localhost origins allowed
- **CSP**: Disabled for easier debugging
- **Rate Limiting**: Higher limits for development workflow
- **Logging**: Full request/response logging enabled
- **HTTPS**: Not required for API keys

### Staging Environment
- **CORS**: Staging domains + localhost
- **CSP**: Enabled with staging-specific domains
- **Rate Limiting**: Moderate limits for testing
- **Logging**: Detailed logging for debugging
- **HTTPS**: Required for API keys

### Production Environment
- **CORS**: Strict origin checking
- **CSP**: Full CSP policy enforced
- **Rate Limiting**: Production-grade limits
- **Logging**: Minimal logging (warn/error only)
- **HTTPS**: Required for all API access

## Security Headers Details

### Content Security Policy (CSP)

**Production CSP**:
```
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: https:;
font-src 'self';
connect-src 'self' https://api.yabaii.day;
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

### Permissions Policy

```
geolocation=(),
microphone=(),
camera=(),
payment=(),
usb=(),
magnetometer=(),
gyroscope=(),
accelerometer=()
```

## Rate Limiting Strategy

### Redis-based Implementation

Rate limiting uses Redis for distributed rate limiting across multiple API instances:

1. **Key Generation**: `rate_limit:{method}:{path}:{client_ip}`
2. **Sliding Window**: Atomic increment with expiration
3. **Headers**: Rate limit information in response headers
4. **Graceful Degradation**: Fails open if Redis is unavailable

### Rate Limiting Algorithm

```typescript
const pipeline = redis.multi();
pipeline.incr(key);                    // Increment counter
pipeline.expire(key, windowSeconds);   // Set expiration
await pipeline.exec();                  // Execute atomically
```

## Authentication Flow

### 1. User Registration
```
POST /api/v1/auth/register
→ Validate input + rate limit
→ Hash password (bcrypt, 12 rounds)
→ Create user in database
→ Generate JWT tokens
→ Return user data + tokens
```

### 2. User Login
```
POST /api/v1/auth/login
→ Rate limit check
→ Validate credentials
→ Generate new tokens
→ Update last login
→ Return user data + tokens
```

### 3. Token Refresh
```
POST /api/v1/auth/refresh
→ Validate refresh token
→ Generate new access token
→ Return new token
```

### 4. Protected Routes
```
Authorization: Bearer <access_token>
→ Verify JWT signature
→ Check token expiration
→ Extract user context
→ Process request
```

## Security Monitoring

### Request Tracking
- **Request ID**: UUID for each request
- **IP Tracking**: Client IP extraction with proxy support
- **User Agent**: Browser/client identification
- **Response Time**: Performance monitoring

### Alerting
- **Rate Limit Hits**: Excessive requests from single IP
- **Authentication Failures**: Failed login attempts
- **Error Rates**: High error rates on endpoints
- **Slow Requests**: Requests taking >1 second

## Security Best Practices

### 1. Environment Variables
- Never commit secrets to version control
- Use strong, unique secrets for each environment
- Rotate JWT secrets regularly
- Use Redis password in production

### 2. Database Security
- Use parameterized queries to prevent SQL injection
- Implement proper user authentication and authorization
- Regular database backups
- Audit logging for sensitive operations

### 3. API Security
- Validate all input data with schemas
- Implement proper error handling without information leakage
- Use HTTPS in production
- Implement API versioning

### 4. Monitoring and Logging
- Monitor for unusual activity patterns
- Log security events separately
- Implement alerting for security incidents
- Regular security audits

## Security Configuration Examples

### Development (.env.development)
```env
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:8081,http://localhost:3000
LOG_LEVEL=debug
LOG_REQUESTS=true
LOG_HEADERS=true
LOG_BODY=true
ENABLE_CORS=true
ENABLE_SECURITY_HEADERS=false  # Disabled for debugging
RATE_LIMIT_MAX_REQUESTS=5000
```

### Production (.env.production)
```env
NODE_ENV=production
ALLOWED_ORIGINS=https://yabaii.day,https://www.yabaii.day
LOG_LEVEL=warn
LOG_REQUESTS=true
LOG_HEADERS=false
LOG_BODY=false
ENABLE_CORS=true
ENABLE_SECURITY_HEADERS=true
RATE_LIMIT_MAX_REQUESTS=1000
VALID_API_KEYS=prod-key-1,prod-key-2
```

## Security Testing

### 1. CORS Testing
```bash
# Test CORS headers
curl -H "Origin: https://malicious-site.com" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: X-Requested-With" \
     -X OPTIONS https://api.yabaii.day/health
```

### 2. Rate Limiting Testing
```bash
# Test rate limiting
for i in {1..1500}; do
  curl -s https://api.yabaii.day/health > /dev/null
  echo "Request $i"
done
```

### 3. Security Headers Testing
```bash
# Test security headers
curl -I https://api.yabaii.day/health
```

### 4. Authentication Testing
```bash
# Test JWT authentication
curl -H "Authorization: Bearer invalid-token" \
     https://api.yabaii.day/api/v1/auth/profile
```

## Incident Response

### Security Incident Response Plan

1. **Detection**: Monitor logs and alerts for suspicious activity
2. **Assessment**: Determine scope and impact of security incident
3. **Containment**: Block malicious IPs, rotate compromised keys
4. **Eradication**: Fix vulnerabilities, update security measures
5. **Recovery**: Restore services, monitor for recurring issues
6. **Lessons Learned**: Update security policies and procedures

### Emergency Contacts

- **Security Team**: security@yabaii.day
- **Development Team**: dev@yabaii.day
- **Infrastructure Team**: infra@yabaii.day

## Compliance

### Data Protection
- **APPI Compliance**: Japanese privacy regulations
- **Data Minimization**: Only collect necessary data
- **Secure Storage**: Encrypt sensitive data at rest
- **Data Retention**: Clear data retention policies

### Security Standards
- **OWASP Top 10**: Protection against common web vulnerabilities
- **ISO 27001**: Information security management
- **SOC 2**: Security and compliance controls

## Regular Security Reviews

### Monthly
- Review security logs and alerts
- Update dependencies and patches
- Monitor rate limiting effectiveness
- Review authentication patterns

### Quarterly
- Security audit and penetration testing
- Review and update security policies
- Training and awareness programs
- Incident response drills

### Annually
- Comprehensive security assessment
- Threat modeling and risk assessment
- Update security architecture
- Compliance audits