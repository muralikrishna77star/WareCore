#!/usr/bin/env powershell
# WareCore Migration Setup Script
# This script sets up the Docker environment and initializes the migration

param(
    [string]$Action = "setup"
)

function Write-Section {
    param([string]$Message)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Check-Prerequisites {
    Write-Section "Checking Prerequisites"
    
    # Check Docker
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Docker is not installed. Please install Docker Desktop." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Docker found: $(docker --version)" -ForegroundColor Green
    
    # Check Node.js
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Node.js is not installed. Please install Node.js 20+." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Node.js found: $(node --version)" -ForegroundColor Green
    
    # Check npm
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "❌ npm is not installed." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ npm found: $(npm --version)" -ForegroundColor Green
}

function Setup-Environment {
    Write-Section "Setting Up Environment"
    
    # Copy environment file if it doesn't exist
    if (-not (Test-Path ".env.local")) {
        if (Test-Path ".env.local.example") {
            Copy-Item ".env.local.example" ".env.local"
            Write-Host "✅ Created .env.local from template" -ForegroundColor Green
        } else {
            Write-Host "⚠️ .env.local.example not found" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✅ .env.local already exists" -ForegroundColor Green
    }
}

function Start-Containers {
    Write-Section "Starting Docker Containers"
    
    Write-Host "Building Docker images..." -ForegroundColor Yellow
    docker-compose build --no-cache
    
    Write-Host "`nStarting containers..." -ForegroundColor Yellow
    docker-compose up -d
    
    # Wait for services to be healthy
    Write-Host "`nWaiting for services to start..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    Write-Host "`n✅ Containers started!" -ForegroundColor Green
    Write-Host "`nService URLs:`n" -ForegroundColor Green
    Write-Host "  📦 PostgreSQL: localhost:5432" -ForegroundColor Cyan
    Write-Host "  🔷 Hasura GraphQL: http://localhost:8080" -ForegroundColor Cyan
    Write-Host "  ⚡ Next.js: http://localhost:3000" -ForegroundColor Cyan
}

function Install-Dependencies {
    Write-Section "Installing Dependencies"
    
    Write-Host "Installing npm dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host "✅ Dependencies installed" -ForegroundColor Green
}

function Run-Migrations {
    Write-Section "Running Database Migrations"
    
    Write-Host "Migrations will be automatically applied when PostgreSQL starts." -ForegroundColor Green
    Write-Host "Check status with: docker-compose logs postgres" -ForegroundColor Yellow
}

function Show-Next-Steps {
    Write-Section "Next Steps"
    
    Write-Host @"
1. ✅ Open Hasura Console: http://localhost:8080
2. ✅ Open Next.js App: http://localhost:3000
3. ✅ Update remaining pages to use GraphQL instead of Supabase
4. ✅ Implement authentication (see MIGRATION_GUIDE.md)
5. ✅ Test all features locally
6. ✅ Deploy to Coolify (see MIGRATION_GUIDE.md)

Useful commands:
  docker-compose logs postgres   # View PostgreSQL logs
  docker-compose logs hasura     # View Hasura logs
  docker-compose logs next       # View Next.js logs
  docker-compose ps              # View all containers
  docker-compose stop            # Stop all containers
  docker-compose down            # Remove all containers

For more information, see: MIGRATION_GUIDE.md
"@ -ForegroundColor Green
}

function Cleanup-Containers {
    Write-Section "Cleaning Up Containers"
    
    Write-Host "Stopping and removing containers..." -ForegroundColor Yellow
    docker-compose down
    Write-Host "✅ Cleanup complete" -ForegroundColor Green
}

# Main logic
switch ($Action) {
    "setup" {
        Check-Prerequisites
        Setup-Environment
        Install-Dependencies
        Start-Containers
        Run-Migrations
        Show-Next-Steps
    }
    "logs" {
        docker-compose logs -f
    }
    "stop" {
        Cleanup-Containers
    }
    "restart" {
        Cleanup-Containers
        Start-Sleep -Seconds 2
        Start-Containers
    }
    default {
        Write-Host @"
WareCore Migration Setup Script

Usage:
  .\setup.ps1 setup      # Complete setup (default)
  .\setup.ps1 logs       # View container logs
  .\setup.ps1 stop       # Stop all containers
  .\setup.ps1 restart    # Restart containers
"@ -ForegroundColor Cyan
    }
}
