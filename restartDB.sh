#!/bin/bash

echo "Running Docker Compose down with volumes..."
docker compose down -v

echo "Starting required services..."
docker compose up -d

echo "Waiting for services to initialize..."
sleep 2

echo "Creating vector extension..."
docker exec -it indieseas-db psql -U root -d indieseas -c "CREATE EXTENSION vector;"

echo "Done!"