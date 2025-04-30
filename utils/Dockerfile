# Use official Bun image
FROM debian

# Set working directory
WORKDIR /app

# Install Python, pip, and dependencies for HuggingFace Transformers
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    pip3 install torch transformers --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

# Copy project files
COPY . .

# Preinstall Bun dependencies
RUN curl -fsSL https://bun.sh/install | bash

RUN bun install

# Expose the API port (default 8888 or environment-defined)
EXPOSE 8888

# Start the Bun server
CMD ["bun", "run", "index.ts"]
