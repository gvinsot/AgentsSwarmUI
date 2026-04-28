import os
import logging

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
if LOG_LEVEL not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"}:
    LOG_LEVEL = "INFO"
logging.basicConfig(level=LOG_LEVEL)
logger = logging.getLogger("openclaw_service")

class HealthCheckFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if "GET /health" in message and "200" in message:
            return False
        return True

logging.getLogger("uvicorn.access").addFilter(HealthCheckFilter())

API_KEY = os.getenv("API_KEY", "change-me-in-production")
DATA_DIR = os.getenv("DATA_DIR", "/app/data")
PROJECTS_DIR = os.getenv("PROJECTS_DIR", "/projects")
TIMEOUT = int(os.getenv("TIMEOUT", "600"))
USERS_DIR = os.path.join(DATA_DIR, "users")