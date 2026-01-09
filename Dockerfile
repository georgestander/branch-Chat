
FROM node:20-slim

RUN apt-get update && apt-get install -y git ca-certificates && rm -rf /var/lib/apt/lists/*

RUN npm i -g @openai/codex

WORKDIR /workspace

ENTRYPOINT ["codex"]
CMD ["--help"]


