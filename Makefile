.DEFAULT_GOAL := help

COMPOSE := docker compose

.PHONY: help setup env build dev up down logs migrate test lint format health config

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: env build ## Prepare environment, build images, start dependencies, and migrate
	$(COMPOSE) up -d --wait postgres redis
	$(COMPOSE) run --rm backend php artisan migrate --force

env: ## Create the ignored local environment file when missing
	./scripts/prepare-env.sh

build: ## Build application containers
	$(COMPOSE) build

dev: env ## Run the complete stack in the foreground
	$(COMPOSE) up --build

up: env ## Start the complete stack in the background
	$(COMPOSE) up -d --build --wait

down: ## Stop application containers
	$(COMPOSE) down

logs: ## Follow application logs
	$(COMPOSE) logs --follow nginx backend queue ai-service

migrate: ## Run Laravel database migrations
	$(COMPOSE) run --rm backend php artisan migrate

test: build ## Run all automated tests
	$(COMPOSE) --profile tools run --rm frontend sh -c "npm ci --no-audit --no-fund && npm test"
	$(COMPOSE) run --rm --no-deps backend composer test
	$(COMPOSE) run --rm --no-deps ai-service python -m pytest

lint: build ## Run all static and formatting checks
	$(COMPOSE) --profile tools run --rm frontend sh -c "npm ci --no-audit --no-fund && npm run lint && npm run format:check"
	$(COMPOSE) run --rm --no-deps backend composer lint
	$(COMPOSE) run --rm --no-deps ai-service ruff check .
	$(COMPOSE) run --rm --no-deps ai-service ruff format --check .

format: build ## Apply automatic formatting
	$(COMPOSE) --profile tools run --rm frontend sh -c "npm ci --no-audit --no-fund && npm run format"
	$(COMPOSE) run --rm --no-deps backend composer format
	$(COMPOSE) run --rm --no-deps ai-service ruff check --fix .
	$(COMPOSE) run --rm --no-deps ai-service ruff format .

health: ## Verify the public application and internal service health
	curl --fail --silent --show-error http://127.0.0.1:$${APP_PORT:-5020}/api/health
	$(COMPOSE) exec ai-service python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

config: ## Validate the resolved Compose configuration
	$(COMPOSE) config --quiet
