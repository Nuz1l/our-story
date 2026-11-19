import logging
import time

from app.db import SessionLocal
from app.services import publish_due


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("our_memories.scheduler")


def main() -> None:
    while True:
        try:
            with SessionLocal() as db:
                publish_due(db)
        except Exception:
            logger.exception("Не удалось опубликовать запланированные записи")
        time.sleep(60)


if __name__ == "__main__":
    main()
