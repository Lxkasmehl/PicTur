"""
Research groups beyond the main (Google Sheets-backed) one.

These groups keep their data in a relational database (PostgreSQL in production) and their
photos under ORG_DATA_DIR/<org_id>/. They work with carapace photos only. Nothing in this
package touches the main group's Sheets, folders or matching cache.
"""
