#!/bin/bash

# Yabaii Mobile App Build Script
# Handles EAS builds and deployment for different environments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$PROJECT_ROOT/apps/mobile"
cd "$APP_DIR"

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

log_info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Check if EAS CLI is installed
check_eas_cli() {
    if ! command -v eas &> /dev/null; then
        log_error "EAS CLI is not installed. Please install it with: npm install -g @expo/eas-cli"
        exit 1
    fi

    local eas_version=$(eas --version)
    log_info "Using EAS CLI version: $eas_version"
}

# Check if user is logged in to EAS
check_eas_login() {
    if ! eas whoami &> /dev/null; then
        log_error "Not logged in to EAS. Please run: eas login"
        exit 1
    fi

    local eas_user=$(eas whoami)
    log_info "Logged in to EAS as: $eas_user"
}

# Validate environment
validate_environment() {
    local env=$1

    case $env in
        development|preview|staging|production)
            log_info "Environment '$env' is valid"
            ;;
        *)
            log_error "Invalid environment '$env'. Valid options: development, preview, staging, production"
            exit 1
            ;;
    esac

    # Check if required files exist
    if [[ ! -f "eas.json" ]]; then
        log_error "eas.json not found in $APP_DIR"
        exit 1
    fi

    if [[ ! -f "app.json" ]]; then
        log_error "app.json not found in $APP_DIR"
        exit 1
    fi

    # Check environment-specific requirements
    if [[ $env == "production" || $env == "staging" ]]; then
        if [[ ! -f "./android-service-account.json" ]]; then
            log_warning "Android service account key not found. Android submission may fail."
        fi
    fi
}

# Pre-build checks
pre_build_checks() {
    log_info "Running pre-build checks..."

    # Check for uncommitted changes
    if [[ -n $(git status --porcelain) ]]; then
        log_warning "You have uncommitted changes. Consider committing them before building."
    fi

    # Check Node.js version
    local node_version=$(node --version)
    log_info "Node.js version: $node_version"

    # Check npm version
    local npm_version=$(npm --version)
    log_info "npm version: $npm_version"

    # Install dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        log_info "Installing dependencies..."
        npm install
    fi

    # Run tests if in CI or if requested
    if [[ $CI == "true" || $RUN_TESTS == "true" ]]; then
        log_info "Running tests..."
        npm test
    fi

    # Check TypeScript compilation
    log_info "Checking TypeScript compilation..."
        npx tsc --noEmit
}

# Build for specific platform and environment
build() {
    local platform=$1
    local environment=$2
    local profile="${environment}"
    local extra_args=""

    # Override profile for specific cases
    if [[ $environment == "development" && $platform == "ios" ]]; then
        extra_args="--profile development"
    fi

    log_info "Starting build for $platform ($environment environment)..."

    # Build command
    eas build \
        --platform $platform \
        --profile $profile \
        --non-interactive \
        --wait \
        $extra_args

    if [[ $? -eq 0 ]]; then
        log "✅ Build completed successfully for $platform ($environment)"
    else
        log_error "❌ Build failed for $platform ($environment)"
        exit 1
    fi
}

# Submit to app stores
submit() {
    local platform=$1
    local environment=$2
    local profile="${environment}"

    log_info "Submitting $platform build to app stores ($environment)..."

    eas submit \
        --platform $platform \
        --profile $profile \
        --non-interactive

    if [[ $? -eq 0 ]]; then
        log "✅ Submission completed successfully for $platform ($environment)"
    else
        log_error "❌ Submission failed for $platform ($environment)"
        exit 1
    fi
}

# Create development build
create_dev_build() {
    local platform=$1

    log_info "Creating development build for $platform..."

    eas build \
        --platform $platform \
        --profile development \
        --non-interactive \
        --wait

    if [[ $? -eq 0 ]]; then
        log "✅ Development build created successfully for $platform"
        log_info "You can now scan the QR code or install the build file."
    else
        log_error "❌ Development build failed for $platform"
        exit 1
    fi
}

# Update app version
update_version() {
    local version_type=$1 # major, minor, patch

    log_info "Updating app version ($version_type)..."

    # Update package.json
    npm version $version_type --no-git-tag-version

    # Update app.json
    local new_version=$(node -p "require('./package.json').version")
    node -e "
        const app = require('./app.json');
        app.expo.version = '$new_version';
        require('fs').writeFileSync('./app.json', JSON.stringify(app, null, 2));
    "

    log "✅ Version updated to $new_version"
    log_info "Don't forget to commit the version changes:"
    echo "git add package.json app.json"
    echo "git commit -m \"chore: bump version to $new_version\""
}

# Display build information
show_build_info() {
    log_info "Build Information:"
    echo "  Project: Yabaii Mobile App"
    echo "  Environment: ${ENVIRONMENT:-development}"
    echo "  Platform: ${PLATFORM:-all}"
    echo "  Timestamp: $(date)"
    echo "  Git Branch: $(git branch --show-current)"
    echo "  Git Commit: $(git rev-parse --short HEAD)"
}

# Help function
show_help() {
    echo "Yabaii Mobile App Build Script"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  build [PLATFORM] [ENVIRONMENT]     Build app for specified platform and environment"
    echo "  submit [PLATFORM] [ENVIRONMENT]    Submit build to app stores"
    echo "  dev [PLATFORM]                    Create development build"
    echo "  version [TYPE]                    Update app version (major|minor|patch)"
    echo "  info                              Show build information"
    echo "  help                              Show this help message"
    echo ""
    echo "Platforms: android, ios, all"
    echo "Environments: development, preview, staging, production"
    echo "Version Types: major, minor, patch"
    echo ""
    echo "Examples:"
    echo "  $0 build ios production           Build iOS app for production"
    echo "  $0 build android staging           Build Android app for staging"
    echo "  $0 submit ios production           Submit iOS build to App Store"
    echo "  $0 dev ios                        Create iOS development build"
    echo "  $0 version patch                   Update patch version"
    echo ""
    echo "Environment Variables:"
    echo "  RUN_TESTS=true                    Run tests before building"
    echo "  SKIP_PRE_CHECKS=true              Skip pre-build checks"
    echo "  PLATFORM                          Default platform (android/ios/all)"
    echo "  ENVIRONMENT                       Default environment"
}

# Main script logic
main() {
    local command=${1:-help}
    local platform=${2:-all}
    local environment=${3:-development}

    # Set environment variables from parameters
    export PLATFORM=${PLATFORM:-$platform}
    export ENVIRONMENT=${ENVIRONMENT:-$environment}

    case $command in
        build)
            log_info "Starting build process..."
            check_eas_cli
            check_eas_login
            validate_environment $environment

            if [[ $SKIP_PRE_CHECKS != "true" ]]; then
                pre_build_checks
            fi

            show_build_info

            if [[ $platform == "all" ]]; then
                build "android" $environment
                build "ios" $environment
            else
                build $platform $environment
            fi
            ;;
        submit)
            log_info "Starting submission process..."
            check_eas_cli
            check_eas_login
            validate_environment $environment
            show_build_info

            if [[ $platform == "all" ]]; then
                submit "android" $environment
                submit "ios" $environment
            else
                submit $platform $environment
            fi
            ;;
        dev)
            log_info "Creating development build..."
            check_eas_cli
            check_eas_login
            show_build_info

            if [[ $platform == "all" ]]; then
                create_dev_build "android"
                create_dev_build "ios"
            else
                create_dev_build $platform
            fi
            ;;
        version)
            update_version $platform
            ;;
        info)
            show_build_info
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"