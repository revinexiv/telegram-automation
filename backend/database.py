from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text,
    ForeignKey, Float, func
)
from datetime import datetime
from backend.config import DATABASE_URL


engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# ─── Models ───────────────────────────────────────────────────────────────────

class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String(20), unique=True, nullable=False)
    session_string = Column(Text, nullable=True)          # encrypted
    status = Column(String(20), default="inactive")       # active/inactive/error/rate_limited
    is_online = Column(Boolean, default=False)
    messages_sent_today = Column(Integer, default=0)
    daily_limit = Column(Integer, default=50)
    last_used = Column(DateTime, nullable=True)
    last_reset = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    mappings = relationship("AccountGroupMapping", back_populates="account", cascade="all, delete")
    logs = relationship("SendLog", back_populates="account")


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(String(50), unique=True, nullable=False)   # Telegram group ID
    username = Column(String(100), nullable=True)
    title = Column(String(255), nullable=False)
    member_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    category = Column(String(100), nullable=True)
    last_sent = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    mappings = relationship("AccountGroupMapping", back_populates="group", cascade="all, delete")
    logs = relationship("SendLog", back_populates="group")


class AccountGroupMapping(Base):
    __tablename__ = "account_group_mapping"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"))
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"))
    assigned_at = Column(DateTime, default=datetime.utcnow)
    is_primary = Column(Boolean, default=True)

    account = relationship("Account", back_populates="mappings")
    group = relationship("Group", back_populates="mappings")


class Template(Base):
    __tablename__ = "templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    media_path = Column(String(500), nullable=True)
    variables = Column(Text, default="[]")    # JSON list of variable names
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    campaigns = relationship("Campaign", back_populates="template")


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    template_id = Column(Integer, ForeignKey("templates.id"))
    status = Column(String(20), default="draft")          # draft/running/paused/completed/stopped
    target_groups = Column(Text, default="[]")            # JSON list of group IDs
    variable_data = Column(Text, default="{}")            # JSON key-value variabel
    schedule_start = Column(DateTime, nullable=True)
    schedule_interval = Column(Integer, default=0)        # jam, 0=sekali
    loop_count = Column(Integer, default=1)               # 0 = unlimited
    delay_min = Column(Integer, default=5)                # detik
    delay_max = Column(Integer, default=20)               # detik
    prevent_duplicate = Column(Boolean, default=False)    # 1 grup = 1 akun
    parallel_mode = Column(Boolean, default=True)         # True=paralel, False=sequential
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    template = relationship("Template", back_populates="campaigns")
    logs = relationship("SendLog", back_populates="campaign", cascade="all, delete")


class SendLog(Base):
    __tablename__ = "send_logs"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"))
    account_id = Column(Integer, ForeignKey("accounts.id"))
    group_id = Column(Integer, ForeignKey("groups.id"))
    status = Column(String(20), nullable=False)           # success/failed/rate_limited/skipped
    error_message = Column(Text, nullable=True)
    message_id = Column(Integer, nullable=True)           # Telegram message ID
    sent_at = Column(DateTime, default=datetime.utcnow)

    campaign = relationship("Campaign", back_populates="logs")
    account = relationship("Account", back_populates="logs")
    group = relationship("Group", back_populates="logs")


# ─── Dependency & Init ────────────────────────────────────────────────────────

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
