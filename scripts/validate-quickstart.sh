#!/bin/bash

# Yabaii Quickstart Validation Script
# Validates that the quickstart setup is working correctly

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
VALIDATION_LOG="$PROJECT_ROOT/validation.log"
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Initialize log file
echo "Yabaii Quickstart Validation - $(date)" > "$VALIDATION_LOG"
echo "========================================" >> "$VALIDATION_LOG"

# Logging functions
log() {
    echo -e "${GREEN}✓ $1${NC}"
    echo "[PASS] $1" >> "$VALIDATION_LOG"
    ((PASSED_CHECKS++))
    ((TOTAL_CHECKS++))
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
    echo "[FAIL] $1" >> "$VALIDATION_LOG"
    ((FAILED_CHECKS++))
    ((TOTAL_CHECKS++))
}

log_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
    echo "[WARN] $1" >> "$VALIDATION_LOG"
}

log_info() {
    echo -e "${BLUE}ℹ $1${NC}"
    echo "[INFO] $1" >> "$VALIDATION_LOG"
}

log_section() {
    echo -e "\n${PURPLE}📋 $1${NC}"
    echo "" >> "$VALIDATION_LOG"
    echo "=== $1 ===" >> "$VALIDATION_LOG"
}

# Header
echo -e "${CYAN}🚀 Yabaii Quickstart Validation${NC}"
echo "This script validates that your development environment is properly set up."
echo ""

# Check prerequisites
check_prerequisites() {
    log_section "Checking Prerequisites"

    # Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        if [[ $NODE_MAJOR -ge 18 ]]; then
            log "Node.js $NODE_VERSION (>= 18.0.0)"
        else
            log_error "Node.js $NODE_VERSION (>= 18.0.0 required)"
        fi
    else
        log_error "Node.js not found"
    fi

    # npm
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        NPM_MAJOR=$(echo $NPM_VERSION | cut -d'.' -f1)
        if [[ $NPM_MAJOR -ge 9 ]]; then
            log "npm $NPM_VERSION (>= 9.0.0)"
        else
            log_error "npm $NPM_VERSION (>= 9.0.0 required)"
        fi
    else
        log_error "npm not found"
    fi

    # Git
    if command -v git &> /dev/null; then
        GIT_VERSION=$(git --version)
        log "Git $GIT_VERSION"
    else
        log_error "Git not found"
    fi

    # Docker (optional but recommended)
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version)
        log "Docker $DOCKER_VERSION"
    else
        log_warning "Docker not found (optional but recommended)"
    fi

    # Docker Compose (optional but recommended)
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_VERSION=$(docker-compose --version)
        log "Docker Compose $DOCKER_COMPOSE_VERSION"
    else
        log_warning "Docker Compose not found (optional but recommended)"
    fi
}

# Check project structure
check_project_structure() {
    log_section "Checking Project Structure"

    # Root files
    if [[ -f "$PROJECT_ROOT/package.json" ]]; then
        log "Root package.json exists"
    else
        log_error "Root package.json not found"
    fi

    if [[ -f "$PROJECT_ROOT/README.md" ]]; then
        log "README.md exists"
    else
        log_warning "README.md not found"
    fi

    # API directory
    if [[ -d "$PROJECT_ROOT/api" ]]; then
        log "API directory exists"

        if [[ -f "$PROJECT_ROOT/api/package.json" ]]; then
            log "API package.json exists"
        else
            log_error "API package.json not found"
        fi

        if [[ -f "$PROJECT_ROOT/api/src/index.ts" ]]; then
            log "API entry point exists"
        else
            log_error "API entry point not found"
        fi
    else
        log_error "API directory not found"
    fi

    # Mobile app directory
    if [[ -d "$PROJECT_ROOT/apps/mobile" ]]; then
        log "Mobile app directory exists"

        if [[ -f "$PROJECT_ROOT/apps/mobile/package.json" ]]; then
            log "Mobile package.json exists"
        else
            log_error "Mobile package.json not found"
        fi

        if [[ -f "$PROJECT_ROOT/apps/mobile/app.json" ]]; then
            log "Mobile app.json exists"
        else
            log_error "Mobile app.json not found"
        fi

        if [[ -f "$PROJECT_ROOT/apps/mobile/eas.json" ]]; then
            log "Mobile eas.json exists"
        else
            log_error "Mobile eas.json not found"
        fi
    else
        log_error "Mobile app directory not found"
    fi

    # Configuration files
    if [[ -f "$PROJECT_ROOT/biome.json" ]]; then
        log "Biome configuration exists"
    else
        log_warning "Biome configuration not found"
    fi

    if [[ -f "$PROJECT_ROOT/tsconfig.json" ]]; then
        log "TypeScript configuration exists"
    else
        log_warning "TypeScript configuration not found"
    fi
}

# Check dependencies
check_dependencies() {
    log_section "Checking Dependencies"

    # Root dependencies
    cd "$PROJECT_ROOT"
    if [[ -d "node_modules" ]]; then
        log "Root node_modules directory exists"

        # Check key dependencies
        if npm list biome &> /dev/null; then
            log "Biome installed"
        else
            log_error "Biome not installed"
        fi

        if npm list typescript &> /dev/null; then
            log "TypeScript installed"
        else
            log_error "TypeScript not installed"
        fi
    else
        log_error "Root node_modules directory not found"
    fi

    # API dependencies
    if [[ -d "$PROJECT_ROOT/api" ]]; then
        cd "$PROJECT_ROOT/api"
        if [[ -d "node_modules" ]]; then
            log "API node_modules directory exists"

            # Check key API dependencies
            if npm list hono &> /dev/null; then
                log "Hono framework installed"
            else
                log_error "Hono framework not installed"
            fi

            if npm list zod &> /dev/null; then
                log "Zod installed"
            else
                log_error "Zod not installed"
            fi
        else
            log_error "API node_modules directory not found"
        fi
    fi

    # Mobile dependencies
    if [[ -d "$PROJECT_ROOT/apps/mobile" ]]; then
        cd "$PROJECT_ROOT/apps/mobile"
        if [[ -d "node_modules" ]]; then
            log "Mobile node_modules directory exists"

            # Check key mobile dependencies
            if npm list expo &> /dev/null; then
                log "Expo installed"
            else
                log_error "Expo not installed"
            fi

            if npm list react &> /dev/null; then
                log "React installed"
            else
                log_error "React not installed"
            fi

            if npm list @tanstack/react-query &> /dev/null; then
                log "React Query installed"
            else
                log_error "React Query not installed"
            fi

            if npm list zustand &> /dev/null; then
                log "Zustand installed"
            else
                log_error "Zustand not installed"
            fi
        else
            log_error "Mobile node_modules directory not found"
        fi
    fi
}

# Check configuration
check_configuration() {
    log_section "Checking Configuration"

    # Environment variables
    if [[ -f "$PROJECT_ROOT/api/.env" ]]; then
        log "API .env file exists"
    else
        log_warning "API .env file not found (copy from .env.example)"
    fi

    if [[ -f "$PROJECT_ROOT/apps/mobile/.env" ]]; then
        log "Mobile .env file exists"
    else
        log_warning "Mobile .env file not found (copy from .env.example)"
    fi

    # Check if example files exist
    if [[ -f "$PROJECT_ROOT/api/.env.example" ]]; then
        log "API .env.example exists"
    else
        log_warning "API .env.example not found"
    fi

    if [[ -f "$PROJECT_ROOT/apps/mobile/.env.example" ]]; then
        log "Mobile .env.example exists"
    else
        log_warning "Mobile .env.example not found"
    fi
}

# Check API server
check_api_server() {
    log_section "Checking API Server"

    if [[ -d "$PROJECT_ROOT/api" ]]; then
        cd "$PROJECT_ROOT/api"

        # Check if TypeScript compilation works
        log_info "Checking TypeScript compilation..."
        if npm run type-check &> /dev/null; then
            log "TypeScript compilation successful"
        else
            log_error "TypeScript compilation failed"
        fi

        # Check if linting passes
        log_info "Checking linting..."
        if npm run lint &> /dev/null; then
            log "Linting successful"
        else
            log_error "Linting failed"
        fi

        # Check if tests pass
        log_info "Running API tests..."
        if npm test &> /dev/null; then
            log "API tests passed"
        else
            log_error "API tests failed"
        fi
    fi
}

# Check mobile app
check_mobile_app() {
    log_section "Checking Mobile App"

    if [[ -d "$PROJECT_ROOT/apps/mobile" ]]; then
        cd "$PROJECT_ROOT/apps/mobile"

        # Check if TypeScript compilation works
        log_info "Checking TypeScript compilation..."
        if npm run type-check &> /dev/null; then
            log "TypeScript compilation successful"
        else
            log_error "TypeScript compilation failed"
        fi

        # Check if linting passes
        log_info "Checking linting..."
        if npm run lint &> /dev/null; then
            log "Linting successful"
        else
            log_error "Linting failed"
        fi

        # Check if tests pass
        log_info "Running mobile tests..."
        if npm test &> /dev/null; then
            log "Mobile tests passed"
        else
            log_error "Mobile tests failed"
        fi

        # Check EAS configuration
        log_info "Checking EAS configuration..."
        if eas build:validate &> /dev/null; then
            log "EAS configuration valid"
        else
            log_error "EAS configuration invalid"
        fi
    fi
}

# Check Docker setup (if applicable)
check_docker_setup() {
    log_section "Checking Docker Setup"

    if command -v docker &> /dev/null && [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
        log "Docker Compose file exists"

        # Check if Docker services can start
        log_info "Testing Docker services..."
        if docker-compose config &> /dev/null; then
            log "Docker Compose configuration valid"
        else
            log_error "Docker Compose configuration invalid"
        fi

        # Check if services are running
        if docker-compose ps &> /dev/null; then
            log "Docker services accessible"
        else
            log_warning "Docker services not running (start with: docker-compose up -d)"
        fi
    else
        log_info "Docker not available or not configured"
    fi
}

# Check build tools
check_build_tools() {
    log_section "Checking Build Tools"

    # Check Expo CLI
    if command -v expo &> /dev/null; then
        EXPO_VERSION=$(expo --version)
        log "Expo CLI $EXPO_VERSION"
    else
        log_error "Expo CLI not found"
    fi

    # Check EAS CLI
    if command -v eas &> /dev/null; then
        EAS_VERSION=$(eas --version)
        log "EAS CLI $EAS_VERSION"

        # Check if logged in
        if eas whoami &> /dev/null; then
            EAS_USER=$(eas whoami)
            log "Logged in to EAS as: $EAS_USER"
        else
            log_warning "Not logged in to EAS (run: eas login)"
        fi
    else
        log_error "EAS CLI not found"
    fi
}

# Run quickstart commands
run_quickstart_commands() {
    log_section "Running Quickstart Commands"

    # Test API health check
    log_info "Testing API health check..."
    if [[ -d "$PROJECT_ROOT/api" ]]; then
        cd "$PROJECT_ROOT/api"
        if npm start &> /dev/null & then
            sleep 5  # Wait for server to start
            if curl -s http://localhost:3001/health &> /dev/null; then
                log "API health check successful"
            else
                log_warning "API health check failed (server may not be running)"
            fi
            pkill -f "npm start" || true
        fi
    fi

    # Test mobile app start
    log_info "Testing mobile app start..."
    if [[ -d "$PROJECT_ROOT/apps/mobile" ]]; then
        cd "$PROJECT_ROOT/apps/mobile"
        # Check if expo start works (timeout after 10 seconds)
        if timeout 10s npx expo start --non-interactive &> /dev/null; then
            log "Mobile app start successful"
        else
            log_warning "Mobile app start failed or timed out"
        fi
    fi
}

# Generate validation report
generate_report() {
    echo ""
    echo -e "${CYAN}📊 Validation Report${NC}"
    echo "===================="
    echo "Total checks: $TOTAL_CHECKS"
    echo -e "Passed: ${GREEN}$PASSED_CHECKS${NC}"
    echo -e "Failed: ${RED}$FAILED_CHECKS${NC}"
    echo ""

    if [[ $FAILED_CHECKS -eq 0 ]]; then
        echo -e "${GREEN}🎉 All checks passed! Your quickstart setup is ready.${NC}"
        echo ""
        echo "Next steps:"
        echo "1. Start the API server: cd api && npm run dev"
        echo "2. Start the mobile app: cd apps/mobile && npm start"
        echo "3. Scan the QR code with Expo Go"
    else
        echo -e "${RED}❌ $FAILED_CHECKS checks failed. Please fix the issues above.${NC}"
        echo ""
        echo "Common fixes:"
        echo "1. Install missing dependencies: npm install"
        echo "2. Set up environment variables: cp .env.example .env"
        echo "3. Install missing tools: npm install -g @expo/cli @expo/eas-cli"
        echo "4. Log in to EAS: eas login"
    fi

    echo ""
    echo "Full validation log saved to: $VALIDATION_LOG"
}

# Main execution
main() {
    echo "Starting quickstart validation..."
    echo "Project root: $PROJECT_ROOT"
    echo ""

    check_prerequisites
    check_project_structure
    check_dependencies
    check_configuration
    check_api_server
    check_mobile_app
    check_docker_setup
    check_build_tools
    run_quickstart_commands
    generate_report

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
        echo "Yabaii Quickstart Validation Script"
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