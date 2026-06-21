# The synth backend HTTP service (server.py) for Railway/Render/Fly/etc.
# No local Docker daemon is needed at runtime — `hud deploy` uploads a build
# context and HUD builds the image remotely. This image just needs Python 3.12,
# the synth package, and the hud CLI (pulled in by hud-python).
FROM python:3.12-slim

WORKDIR /app

# Install deps first (better layer caching), then the package.
COPY pyproject.toml ./
COPY synth ./synth
COPY deploy_one.py eval_one.py server.py ./
RUN pip install --no-cache-dir .

# Railway/Render set $PORT; default to 8000 locally.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
