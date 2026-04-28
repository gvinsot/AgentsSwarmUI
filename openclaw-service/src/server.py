#!/usr/bin/env python3
"""
OpenClaw Service - FastAPI backend
Provides shell execution and message processing endpoints.
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
import uvicorn

from config import logger
from routes_api import router as api_router

app = FastAPI(
    title="OpenClaw Service",
    description="Shell execution and message processing service",
    version="1.0.0",
)

app.include_router(api_router)


@asynccontextmanager
async def lifespan(application: FastAPI):
    logger.info("OpenClaw Service starting...")
    yield
    logger.info("OpenClaw Service shutting down...")

app.router.lifespan_context = lifespan

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )