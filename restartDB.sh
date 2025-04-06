#!/bin/bash

echo "Running Docker Compose down with volumes..."
docker compose down -v

echo "Starting required services..."
docker compose up -d

echo "Waiting for services to initialize..."
sleep 2
docker exec -it indieseas-db psql -U root -d indieseas -c "CREATE EXTENSION vector;"
sleep 2

echo "Running Drizzle migration..."
bun drizzle-kit push

echo "Done!"