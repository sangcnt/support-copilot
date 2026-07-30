#!/bin/sh

set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
environment_file="$project_root/.env"
example_file="$project_root/.env.example"

if [ -f "$environment_file" ]; then
    exit 0
fi

cp "$example_file" "$environment_file"

generated_key="base64:$(openssl rand -base64 32)"
temporary_file="$environment_file.tmp"

awk -v app_key="$generated_key" '
    /^APP_KEY=$/ {
        print "APP_KEY=" app_key
        next
    }
    { print }
' "$environment_file" > "$temporary_file"

mv "$temporary_file" "$environment_file"
printf '%s\n' "Created .env with a local application key."
