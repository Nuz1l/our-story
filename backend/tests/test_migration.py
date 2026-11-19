from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.db import Base
from app import models  # noqa: F401


def test_initial_migration_matches_models():
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    engine.dispose()
    assert differences == []
