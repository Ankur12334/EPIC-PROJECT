# alembic/versions/0001_initial.py
# alembic migration stub for initial tables - run `alembic revision --autogenerate -m "initial"` locally to generate
from alembic import op
import sqlalchemy as sa

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('users',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('email', sa.String(length=256), nullable=False),
        sa.Column('hashed_password', sa.String(length=256), nullable=False),
        sa.Column('phone', sa.String(length=32), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_table('properties',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('price', sa.Float(), nullable=False),
        sa.Column('type', sa.String(length=32), nullable=False),
        sa.Column('gender', sa.String(length=16), nullable=False),
        sa.Column('city', sa.String(length=128), nullable=False),
        sa.Column('locality', sa.String(length=128), nullable=True),
        sa.Column('images', sa.JSON(), nullable=False),
        sa.Column('host_id', sa.Integer(), nullable=False),
        sa.Column('available', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
    )
    op.create_table('bookings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('property_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('start_date', sa.DateTime(), nullable=False),
        sa.Column('end_date', sa.DateTime(), nullable=False),
        sa.Column('total_price', sa.Float(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('cancelled_at', sa.DateTime(), nullable=True),
    )
    op.create_table('refresh_tokens',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=512), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )

def downgrade():
    op.drop_table('refresh_tokens')
    op.drop_table('bookings')
    op.drop_table('properties')
    op.drop_table('users')
