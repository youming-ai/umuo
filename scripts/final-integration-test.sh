#!/bin/bash

# Yabaii Final Integration Test Script
# Performs comprehensive integration testing and validation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTEGRATION_LOG="$PROJECT_ROOT/integration-test.log"
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Initialize log file
echo "Yabaii Final Integration Test - $(date)" > "$INTEGRATION_LOG"
echo "========================================" >> "$INTEGRATION_LOG"

# Logging functions
log() {
    echo -e "${GREEN}✓ $1${NC}"
    echo "[PASS] $1" >> "$INTEGRATION_LOG"
    ((PASSED_CHECKS++))
    ((TOTAL_CHECKS++))
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
    echo "[FAIL] $1" >> "$INTEGRATION_LOG"
    ((FAILED_CHECKS++))
    ((TOTAL_CHECKS++))
}

log_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
    echo "[WARN] $1" >> "$INTEGRATION_LOG"
}

log_info() {
    echo -e "${BLUE}ℹ $1${NC}"
    echo "[INFO] $1" >> "$INTEGRATION_LOG"
}

log_section() {
    echo -e "\n${PURPLE}🔍 $1${NC}"
    echo "" >> "$INTEGRATION_LOG"
    echo "=== $1 ===" >> "$INTEGRATION_LOG"
}

# Header
echo -e "${CYAN}🧪 Yabaii Final Integration Testing${NC}"
echo "This script performs comprehensive integration testing and validation."
echo ""

# Check project structure integrity
check_project_integrity() {
    log_section "Project Structure Integrity"

    # Required directories
    local required_dirs=(
        "api/src"
        "api/tests"
        "apps/mobile/src"
        "apps/mobile/tests"
        "docs"
        "scripts"
    )

    for dir in "${required_dirs[@]}"; do
        if [[ -d "$PROJECT_ROOT/$dir" ]]; then
            log "Directory exists: $dir"
        else
            log_error "Required directory missing: $dir"
        fi
    done

    # Required configuration files
    local required_files=(
        "package.json"
        "README.md"
        "api/package.json"
        "apps/mobile/package.json"
        "apps/mobile/app.json"
        "apps/mobile/eas.json"
    )

    for file in "${required_files[@]}"; do
        if [[ -f "$PROJECT_ROOT/$file" ]]; then
            log "Configuration file exists: $file"
        else
            log_error "Required configuration file missing: $file"
        fi
    done
}

# Test API backend
test_api_backend() {
    log_section "API Backend Integration"

    if [[ ! -d "$PROJECT_ROOT/api" ]]; then
        log_error "API directory not found"
        return
    fi

    cd "$PROJECT_ROOT/api"

    # Check dependencies
    if [[ ! -d "node_modules" ]]; then
        log_warning "API dependencies not installed"
        log_info "Installing API dependencies..."
        npm install &> /dev/null || log_error "Failed to install API dependencies"
    fi

    # Check TypeScript compilation
    log_info "Checking TypeScript compilation..."
    if npm run type-check &> /dev/null; then
        log "API TypeScript compilation successful"
    else
        log_error "API TypeScript compilation failed"
    fi

    # Check linting
    log_info "Checking API linting..."
    if npm run lint &> /dev/null; then
        log "API linting successful"
    else
        log_error "API linting failed"
    fi

    # Run API tests
    log_info "Running API tests..."
    if npm test &> /dev/null; then
        log "API tests passed"
    else
        log_error "API tests failed"
    fi

    # Test API health endpoint
    log_info "Testing API health endpoint..."
    if npm start &> /dev/null & then
        sleep 5
        if curl -s http://localhost:3001/health &> /dev/null; then
            log "API health endpoint responding"
        else
            log_warning "API health endpoint not responding (server may not be running)"
        fi
        pkill -f "npm start" || true
    else
        log_warning "Could not start API server for health check"
    fi
}

# Test mobile app
test_mobile_app() {
    log_section "Mobile App Integration"

    if [[ ! -d "$PROJECT_ROOT/apps/mobile" ]]; then
        log_error "Mobile app directory not found"
        return
    fi

    cd "$PROJECT_ROOT/apps/mobile"

    # Check dependencies
    if [[ ! -d "node_modules" ]]; then
        log_warning "Mobile dependencies not installed"
        log_info "Installing mobile dependencies..."
        npm install &> /dev/null || log_error "Failed to install mobile dependencies"
    fi

    # Check TypeScript compilation
    log_info "Checking mobile TypeScript compilation..."
    if npm run type-check &> /dev/null; then
        log "Mobile TypeScript compilation successful"
    else
        log_error "Mobile TypeScript compilation failed"
    fi

    # Check linting
    log_info "Checking mobile linting..."
    if npm run lint &> /dev/null; then
        log "Mobile linting successful"
    else
        log_error "Mobile linting failed"
    fi

    # Run mobile tests
    log_info "Running mobile tests..."
    if npm test &> /dev/null; then
        log "Mobile tests passed"
    else
        log_error "Mobile tests failed"
    fi

    # Check Expo configuration
    log_info "Validating Expo configuration..."
    if npx expo config --type introspect &> /dev/null; then
        log "Expo configuration valid"
    else
        log_error "Expo configuration invalid"
    fi

    # Check EAS configuration
    log_info "Validating EAS configuration..."
    if eas build:validate &> /dev/null; then
        log "EAS configuration valid"
    else
        log_error "EAS configuration invalid"
    fi
}

# Test database connectivity
test_database_connectivity() {
    log_section "Database Connectivity"

    # Check PostgreSQL configuration
    if [[ -f "$PROJECT_ROOT/api/.env" ]]; then
        if grep -q "DATABASE_URL" "$PROJECT_ROOT/api/.env"; then
            log "Database URL configured"
        else
            log_warning "Database URL not configured in .env"
        fi
    else
        log_warning "API .env file not found"
    fi

    # Check Redis configuration
    if [[ -f "$PROJECT_ROOT/api/.env" ]]; then
        if grep -q "REDIS_URL" "$PROJECT_ROOT/api/.env"; then
            log "Redis URL configured"
        else
            log_warning "Redis URL not configured in .env"
        fi
    fi

    # Test Docker services if available
    if command -v docker-compose &> /dev/null && [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
        log_info "Testing Docker services..."
        if docker-compose ps &> /dev/null; then
            log "Docker services accessible"
        else
            log_warning "Docker services not running"
        fi
    fi
}

# Test documentation
test_documentation() {
    log_section "Documentation Validation"

    # Required documentation files
    local doc_files=(
        "README.md"
        "docs/API_DOCUMENTATION.md"
        "docs/DEPLOYMENT_GUIDE.md"
        "docs/SETUP_GUIDE.md"
    )

    for file in "${doc_files[@]}"; do
        if [[ -f "$PROJECT_ROOT/$file" ]]; then
            log "Documentation exists: $file"
        else
            log_warning "Documentation missing: $file"
        fi
    done

    # Check API documentation
    if [[ -f "$PROJECT_ROOT/docs/API_DOCUMENTATION.md" ]]; then
        if grep -q "OpenAPI" "$PROJECT_ROOT/docs/API_DOCUMENTATION.md"; then
            log "API documentation includes OpenAPI specification"
        else
            log_warning "API documentation missing OpenAPI specification"
        fi
    fi
}

# Test build configuration
test_build_configuration() {
    log_section "Build Configuration"

    # Test API build
    if [[ -d "$PROJECT_ROOT/api" ]]; then
        cd "$PROJECT_ROOT/api"
        log_info "Testing API build..."
        if npm run build &> /dev/null; then
            log "API build successful"
        else
            log_error "API build failed"
        fi
    fi

    # Test mobile build configuration
    if [[ -d "$PROJECT_ROOT/apps/mobile" ]]; then
        cd "$PROJECT_ROOT/apps/mobile"
        log_info "Testing mobile build configuration..."
        if npx expo export &> /dev/null; then
            log "Mobile export build successful"
        else
            log_warning "Mobile export build failed"
        fi
    fi

    # Check EAS build profiles
    if [[ -f "$PROJECT_ROOT/apps/mobile/eas.json" ]]; then
        local profiles=("development" "preview" "staging" "production")
        for profile in "${profiles[@]}"; do
            if grep -q "\"$profile\"" "$PROJECT_ROOT/apps/mobile/eas.json"; then
                log "EAS build profile exists: $profile"
            else
                log_error "EAS build profile missing: $profile"
            fi
        done
    fi
}

# Test security configuration
test_security_configuration() {
    log_section "Security Configuration"

    # Check for .gitignore
    if [[ -f "$PROJECT_ROOT/.gitignore" ]]; then
        log ".gitignore exists"
        if grep -q "node_modules" "$PROJECT_ROOT/.gitignore"; then
            log "node_modules excluded from git"
        else
            log_warning "node_modules not excluded from .gitignore"
        fi

        if grep -q ".env" "$PROJECT_ROOT/.gitignore"; then
            log "Environment files excluded from git"
        else
            log_warning "Environment files not excluded from .gitignore"
        fi
    else
        log_error ".gitignore file missing"
    fi

    # Check for secret management
    local secret_patterns=(
        "api/.env"
        "apps/mobile/.env"
        "*.key"
        "*.pem"
        "android-service-account.json"
    )

    for pattern in "${secret_patterns[@]}"; do
        if [[ -f "$PROJECT_ROOT/$pattern" ]]; then
            if grep -q "$pattern" "$PROJECT_ROOT/.gitignore"; then
                log "Secret file properly excluded: $pattern"
            else
                log_warning "Secret file not excluded from git: $pattern"
            fi
        fi
    done
}

# Test performance
test_performance() {
    log_section "Performance Validation"

    # Check bundle size (approximate)
    if [[ -d "$PROJECT_ROOT/apps/mobile" ]]; then
        cd "$PROJECT_ROOT/apps/mobile"
        log_info "Estimating bundle size..."

        # Check package.json size
        local package_size=$(du -sk package.json | cut -f1)
        if [[ $package_size -lt 50 ]]; then
            log "Package.json size reasonable: ${package_size}KB"
        else
            log_warning "Package.json size large: ${package_size}KB"
        fi

        # Check dependencies count
        local dep_count=$(npm ls --depth=0 --json | jq -r '.dependencies | keys | length' 2>/dev/null || echo "N/A")
        log "Direct dependencies: $dep_count"
    fi

    # Check for performance optimization files
    local perf_files=(
        "apps/mobile/src/services/AnalyticsService.ts"
        "apps/mobile/src/components/images/OptimizedImage.ts"
        "apps/mobile/src/hooks/useAnalytics.ts"
    )

    for file in "${perf_files[@]}"; do
        if [[ -f "$PROJECT_ROOT/$file" ]]; then
            log "Performance optimization file exists: $file"
        else
            log_warning "Performance optimization file missing: $file"
        fi
    done
}

# Test accessibility
test_accessibility() {
    log_section "Accessibility Validation"

    # Check accessibility components
    local a11y_files=(
        "apps/mobile/src/components/accessibility/AccessibleText.tsx"
        "apps/mobile/src/components/accessibility/AccessibleButton.tsx"
        "apps/mobile/src/components/accessibility/AccessibleForm.tsx"
        "apps/mobile/src/components/accessibility/AccessibleImage.tsx"
        "apps/mobile/src/services/AccessibilityService.ts"
    )

    for file in "${a11y_files[@]}"; do
        if [[ -f "$PROJECT_ROOT/$file" ]]; then
            log "Accessibility component exists: $file"
        else
            log_warning "Accessibility component missing: $file"
        fi
    done

    # Check accessibility tests
    if [[ -f "$PROJECT_ROOT/apps/mobile/tests/accessibility/test_accessibility_components.test.tsx" ]]; then
        log "Accessibility tests exist"
    else
        log_warning "Accessibility tests missing"
    fi
}

# Test error handling
test_error_handling() {
    log_section "Error Handling Validation"

    # Check error handling components
    local error_files=(
        "apps/mobile/src/components/error/ErrorBoundary.tsx"
        "apps/mobile/src/components/error/AsyncErrorBoundary.tsx"
        "apps/mobile/src/services/ErrorReportingService.ts"
    )

    for file in "${error_files[@]}"; do
        if [[ -f "$PROJECT_ROOT/$file" ]]; then
            log "Error handling component exists: $file"
        else
            log_warning "Error handling component missing: $file"
        fi
    done

    # Check error tests
    if [[ -f "$PROJECT_ROOT/apps/mobile/tests/error/test_error_boundaries.test.tsx" ]]; then
        log "Error handling tests exist"
    else
        log_warning "Error handling tests missing"
    fi
}

# Test quickstart validation
test_quickstart_validation() {
    log_section "Quickstart Validation"

    # Check quickstart script
    if [[ -f "$PROJECT_ROOT/scripts/validate-quickstart.sh" ]]; then
        log "Quickstart validation script exists"

        # Test script execution
        if timeout 60s "$PROJECT_ROOT/scripts/validate-quickstart.sh" &> /dev/null; then
            log "Quickstart validation script runs successfully"
        else
            log_warning "Quickstart validation script failed or timed out"
        fi
    else
        log_error "Quickstart validation script missing"
    fi

    # Check quickstart documentation
    if [[ -f "$PROJECT_ROOT/docs/SETUP_GUIDE.md" ]]; then
        log "Setup guide documentation exists"
    else
        log_warning "Setup guide documentation missing"
    fi
}

# Run comprehensive test suite
run_comprehensive_tests() {
    log_section "Comprehensive Test Suite"

    # Run all tests
    local test_results=()

    # API tests
    if [[ -d "$PROJECT_ROOT/api" ]]; then
        cd "$PROJECT_ROOT/api"
        if npm test &> /dev/null; then
            test_results+=("API: PASS")
            log "API test suite: PASSED"
        else
            test_results+=("API: FAIL")
            log_error "API test suite: FAILED"
        fi
    fi

    # Mobile tests
    if [[ -d "$PROJECT_ROOT/apps/mobile" ]]; then
        cd "$PROJECT_ROOT/apps/mobile"
        if npm test &> /dev/null; then
            test_results+=("Mobile: PASS")
            log "Mobile test suite: PASSED"
        else
            test_results+=("Mobile: FAIL")
            log_error "Mobile test suite: FAILED"
        fi
    fi

    # Report results
    log_info "Test Suite Summary:"
    for result in "${test_results[@]}"; do
        echo "  - $result"
    done
}

# Generate final report
generate_final_report() {
    echo ""
    echo -e "${CYAN}📊 Final Integration Test Report${NC}"
    echo "======================================"
    echo "Total checks: $TOTAL_CHECKS"
    echo -e "Passed: ${GREEN}$PASSED_CHECKS${NC}"
    echo -e "Failed: ${RED}$FAILED_CHECKS${NC}"
    echo ""

    local success_rate=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))
    echo "Success rate: $success_rate%"

    if [[ $FAILED_CHECKS -eq 0 ]]; then
        echo -e "${GREEN}🎉 All integration tests passed! The implementation is ready.${NC}"
        echo ""
        echo "Next steps:"
        echo "1. Review the implementation against requirements"
        echo "2. Perform final manual testing"
        echo "3. Prepare for production deployment"
        echo "4. Create release documentation"
    else
        echo -e "${RED}❌ $FAILED_CHECKS checks failed. Please address the issues above.${NC}"
        echo ""
        echo "Common fixes:"
        echo "1. Install missing dependencies: npm install"
        echo "2. Fix TypeScript errors: npm run type-check"
        echo "3. Fix linting errors: npm run lint:fix"
        echo "4. Run failing tests: npm test"
        echo "5. Check environment configuration"
    fi

    echo ""
    echo "Full integration test log saved to: $INTEGRATION_LOG"
}

# Main execution
main() {
    echo "Starting final integration testing..."
    echo "Project root: $PROJECT_ROOT"
    echo ""

    check_project_integrity
    test_api_backend
    test_mobile_app
    test_database_connectivity
    test_documentation
    test_build_configuration
    test_security_configuration
    test_performance
    test_accessibility
    test_error_handling
    test_quickstart_validation
    run_comprehensive_tests
    generate_final_report

    # Exit with appropriate code
    if [[ $FAILED_CHECKS -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Yabaii Final Integration Test Script"
        echo ""
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --verbose, -v  Show detailed output"
        echo "  --quiet, -q    Suppress output"
        echo ""
        exit 0
        ;;
    --verbose|-v)
        set -x
        main
        ;;
    --quiet|-q)
        exec 1>/dev/null
        main
        ;;
    *)
        main
        ;;
esac