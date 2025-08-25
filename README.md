# IndieSeas.net - WIP Search Engine based in 88x31 Buttons
Hi there! This is the full open source code for IndieSeas(indieseas.net). Down here there'll be a guide about how to setup your very own IndieSeas instance! But before that, you'll need the following:

- Cloudflare Worker that returns a JSON response (more on that later)
- Enough storage for Go, Node.js, NPM and Docker


Good luck C:

## Setup Guide

### 1. Prepare Go, Node.js (npm) and Docker

First of all, you'll need to install both Node.js and Go. Node.js powers the frontend and Go powers the scraper. Docker is used for the PostgreSQL database.

1. Install [Go](https://golang.org/doc/install) (latest).
2. Install [Node.js](https://nodejs.org/) (latest).
3. Install [Docker](https://docs.docker.com/get-docker/) (latest).

Right after you've installed docker, you will want to copypaste this setup into a `docker-compose.yml` file:

```yaml
services:
  db:
    image: postgres:17
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: always
    container_name: indieseas-db
    ports:
      - 5432:5432
    environment:
      POSTGRES_USER: root
      POSTGRES_PASSWORD: databasepassword
      POSTGRES_DB: indieseas

volumes:
  pgdata:
```

### 2. Setup your own Cloudflare Worker

This is way more simple than what it looks, all you need to do is create a Cloudflare account, then a Cloudflare Worker (free tier will be more than enough, 100,000 requests/day) and then copypaste the contents from `worker.js` to your Worker. Make sure to setup an `API_KEY` environment variable in your Worker settings. Also make sure to deploy it, duh!!

### 3. Start the Database

Then, in the same directory as the `docker-compose.yml`, run `docker compose up -d`. This will start the PostgreSQL database in a Docker container, AND keep it running on the background.

### 4. Setup the .env

Then, create a `.env` file in the root of the project, and copypaste the following:

```
DB_URL=postgresql://root:<YOUR_PASSWORD_HERE>@localhost:5432/indieseas
SCRAPER_WORKER=<SCRAPER_WORKER_URL_HERE>
```

Make sure to set `SCRAPER_WORKER` to your FULL Cloudflare Worker URL in the following format:

```
SCRAPER_WORKER=https://<YOUR_WORKER_SUBDOMAIN_HERE>.workers.dev/?key=<YOUR_API_KEY_HERE>&path=
```

### 5. Setup the scraper

Open a terminal and navigate to the `scraper` directory:

```bash
cd scraper
```

Then, just run the following:

```bash
go run .
```

Voilá! Your scraper is running. Let it do its thing!

### 6. Setup the frontend

First of all, you'll need to install the required dependencies for the frontend. Navigate to the `frontend` directory:

```bash
cd frontend
```

Then, just run the following:

```bash
npm install
```

Then, run the following:

```bash
npm run dev
```

And look at it! Your very own IndieSeas instance is set up and ready to go!

---

Thank you very much for using IndieSeas! If you have any questions or feedback, feel free to reach out.