# IndieSearch

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/mrdapoyo/indieseas
   cd indieseas
   ```

2. Install dependencies for the frontend:

   ```bash
   cd frontend/
   npm install
   ```

3. Run the project!

   ```bash
   npm run dev
   ```

## Database Setup

Start the PostgreSQL container with vector support:

```bash
docker exec -it pgvector-db psql -U root -d indiesea

CREATE EXTENSION vector;
```

## Running the Application

### Development Mode

Default frontend port: 8080

Start the API server:

```bash
PORT=80 node ./dist/server/entry.mjs
```

Default API port: 8000

### Production with Docker

Build the Docker image:

```bash
docker build -t indieseas-ai-api .
```

Run the container:

```bash
docker run -p 8888:8888 indieseas-ai-api
```

## API Endpoints

The API server runs on port 8000 by default and provides endpoints for search functionality.

## Configuration

- Frontend port: 8080 (default)
- API port: 8000 (default)
- AI Embedding port: 8888