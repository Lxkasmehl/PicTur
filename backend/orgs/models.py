"""
Storage of the database-backed research groups.

A research group works exactly like the main group; only its "spreadsheets" live here instead of
Google Sheets. Each group has two books ('research' and 'community', like the two spreadsheets of
the main group), each book has tabs (sheets) and each tab has rows of cells — see
orgs.sheets_store, which serves them through the Google Sheets API surface the app uses.
"""

from sqlalchemy import JSON, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JsonType = JSON().with_variant(JSONB(), 'postgresql')

BOOKS = ('research', 'community')


class Base(DeclarativeBase):
    pass


class SheetTab(Base):
    __tablename__ = 'sheet_tabs'
    __table_args__ = (
        UniqueConstraint('org_id', 'book', 'title', name='uq_sheet_tabs_title'),
        UniqueConstraint('org_id', 'book', 'sheet_id', name='uq_sheet_tabs_sheet_id'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, index=True)
    book: Mapped[str] = mapped_column(String(20))
    sheet_id: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    position: Mapped[int] = mapped_column(Integer, default=0)


class SheetRow(Base):
    """One spreadsheet row; cells is a list of strings (column A first), trailing blanks trimmed."""

    __tablename__ = 'sheet_rows'

    org_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    book: Mapped[str] = mapped_column(String(20), primary_key=True)
    sheet_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: 0-based (spreadsheet row 1 = index 0, i.e. the header row)
    row_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    cells: Mapped[list] = mapped_column(JsonType, default=list)
