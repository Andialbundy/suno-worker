FROM ubuntu:22.04

# Install bun + build tools
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg unzip python3 build-essential && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun && \
    apt-get remove -y curl gnupg unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Add Google Chrome repository
RUN apt-get update && apt-get install -y --no-install-recommends wget gnupg && \
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get remove -y wget gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Install Chrome + Xvfb + dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    google-chrome-stable \
    xvfb \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PROFILE_DIR=/root/chrome-profile
WORKDIR /app

# Copy package files first for caching
COPY package.json package-lock.json ./
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY .env ./

# Create chrome profile directory
RUN mkdir -p /root/chrome-profile

# Run with Xvfb
CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x720x24 & sleep 2 && bun run src/worker.mjs --chrome"]
