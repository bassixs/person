"""iteration4 semantic chunks (pgvector, E-037)

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-20
"""
from alembic import op
import sqlalchemy as sa

from app.models import VECTOR_DIM, Vector

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column('knowledge_items', sa.Column('index_status', sa.String(length=16), server_default='none', nullable=False))
    op.add_column('knowledge_items', sa.Column('index_error', sa.Text(), nullable=True))
    op.add_column('knowledge_items', sa.Column('index_model', sa.String(length=200), nullable=True))
    op.add_column('knowledge_items', sa.Column('indexed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('knowledge_items', sa.Column('chunks_count', sa.Integer(), server_default='0', nullable=False))
    op.create_table(
        'knowledge_chunks',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('item_id', sa.UUID(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('char_start', sa.Integer(), nullable=False),
        sa.Column('page', sa.Integer(), nullable=True),
        sa.Column('embedding', Vector(VECTOR_DIM), nullable=False),
        sa.Column('model', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['item_id'], ['knowledge_items.id'], name=op.f('fk_knowledge_chunks_item_id_knowledge_items'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_knowledge_chunks')),
        sa.UniqueConstraint('item_id', 'position', name='uq_chunk_position'),
    )
    op.create_index(op.f('ix_knowledge_chunks_item_id'), 'knowledge_chunks', ['item_id'], unique=False)
    op.execute(
        "CREATE INDEX ix_knowledge_chunks_embedding ON knowledge_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_knowledge_chunks_embedding")
    op.drop_index(op.f('ix_knowledge_chunks_item_id'), table_name='knowledge_chunks')
    op.drop_table('knowledge_chunks')
    for c in ('chunks_count', 'indexed_at', 'index_model', 'index_error', 'index_status'):
        op.drop_column('knowledge_items', c)
