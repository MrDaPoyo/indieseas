FROM oven/bun:latest AS base
WORKDIR /usr/src/app

RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    pip3 install torch transformers --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/src/app/node_modules/@huggingface/transformers/.cache && \
    chown -R bun:bun /usr/src/app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb* /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lockb* /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/vectorize.ts .
COPY --from=prerelease /usr/src/app/package.json .

USER bun
EXPOSE 8888/tcp
ENTRYPOINT [ "bun", "run", "vectorize.ts" ]
