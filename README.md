# indiesearch
`PORT=8080 node ./dist/server/entry.mjs`
Default api port: 8000
Default frontend port: 8080

```
docker exec -it pgvector-db psql -U root -d indiesea

CREATE EXTENSION vector;
```

```
# Build the Docker image
docker build -t indieseas-vectorizer .

# Run it
docker run -p 8888:8888 indieseas-vectorizer
```