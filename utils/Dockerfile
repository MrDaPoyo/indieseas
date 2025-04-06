# Use official Bun image
FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Install Python and dependencies for HuggingFace Transformers
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    pip3 install --upgrade pip && \
    pip3 install torch transformers

# Copy project files
COPY . .

# Preinstall Bun dependencies
RUN bun install

# Expose the API port (default 8888 or environment-defined)
EXPOSE 8888

# Start the Bun server
CMD ["bun", "run", "index.ts"]
