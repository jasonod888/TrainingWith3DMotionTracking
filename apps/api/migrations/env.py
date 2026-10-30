from alembic import context
from apps.api.config import Settings
from apps.api.database import Base, make_engine

config = context.config
target_metadata = Base.metadata
if context.is_offline_mode():
    context.configure(url=Settings().sqlalchemy_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = make_engine(Settings().sqlalchemy_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
