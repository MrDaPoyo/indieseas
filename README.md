# IndieSearch

A modern search application built with AI capabilities and vector search functionality. This project combines a Node.js backend with PostgreSQL vector extensions for advanced search features.

## Features

- AI-powered search capabilities
- Vector similarity search using pgvector
- RESTful API backend
- Docker containerization
- PostgreSQL with vector extensions

## Prerequisites

- Node.js (v16 or higher)
- Docker and Docker Compose
- PostgreSQL with pgvector extension

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd indiesearch
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the project:

   ```bash
   npm run build
   ```

## Database Setup

Start the PostgreSQL container with vector support:

```bash
docker exec -it pgvector-db psql -U root -d indiesea

CREATE EXTENSION vector;
```

## Running the Application

### Development Mode

Start the frontend development server:

```bash
npm run dev
```

Default frontend port: 8080

Start the API server:

```bash
PORT=8080 node ./dist/server/entry.mjs
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
- Docker container port: 8888

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

[Add your license information here]

