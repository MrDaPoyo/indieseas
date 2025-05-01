@echo off
echo Running Docker Compose down with volumes...
docker compose down -v

echo Starting required services...
docker compose up -d

echo Waiting for services to initialize...
timeout /t 2 /nobreak >nul

docker exec -it indieseas-db psql -U root -d indieseas -c "CREATE EXTENSION vector;"

exit

echo Done!