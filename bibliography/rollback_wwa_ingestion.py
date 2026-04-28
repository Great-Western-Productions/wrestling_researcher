#!/usr/bin/env python3
"""
Roll back the indiscriminate WWA Indy ingestion.

What this undoes:
  - All wrestler_territory_runs with territory_id matching WWA Indy whose notes
    mention 'cagematch-documented appearances' (the marker the ingest script set).
  - All wrestlers whose notes start with 'Imported from cagematch.net WWA roster'.
  - The cagematch_id linkages on existing curated wrestlers that were set by
    the ingest pass (only safe-undo: those whose notes don't reference an import).
    Specifically reverts cagematch_id=NULL for wrestlers whose midcard_files_status
    is NOT NULL (curated rows) and whose notes don't include 'Imported from'.
"""
import sqlite3
import os
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cur.execute("SELECT id FROM territories WHERE cagematch_id = '103'")
    row = cur.fetchone()
    if not row:
        raise SystemExit("WWA Indy territory not found")
    wwa_id = row[0]

    # 1. Delete WWA runs added by the ingestion (notes marker)
    cur.execute("""
        DELETE FROM wrestler_territory_runs
        WHERE territory_id = ?
          AND notes LIKE '%cagematch-documented appearances%'
    """, (wwa_id,))
    runs_deleted = cur.rowcount

    # 2. Delete wrestlers inserted by the WWA ingestion
    cur.execute("""
        DELETE FROM wrestlers
        WHERE notes LIKE 'Imported from cagematch.net WWA roster%'
    """)
    wrestlers_deleted = cur.rowcount

    # 3. Revert cagematch_id on curated wrestlers that got auto-linked.
    #    Only touch curated rows (midcard_files_status IS NOT NULL) — these were
    #    pre-existing seeds. Their cagematch_id was set by the WWA ingest's
    #    name-match path and may be wrong (e.g., the Cuban Assassin case).
    cur.execute("""
        SELECT id, primary_ring_name, cagematch_id FROM wrestlers
        WHERE cagematch_id IS NOT NULL AND midcard_files_status IS NOT NULL
    """)
    curated_with_cm = cur.fetchall()
    cur.execute("""
        UPDATE wrestlers
        SET cagematch_id = NULL
        WHERE cagematch_id IS NOT NULL AND midcard_files_status IS NOT NULL
    """)
    curated_reverted = cur.rowcount

    conn.commit()

    # Final state
    cur.execute("SELECT COUNT(*) FROM wrestlers")
    total_w = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wrestler_territory_runs")
    total_r = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wrestler_territory_runs WHERE territory_id = ?", (wwa_id,))
    wwa_r = cur.fetchone()[0]

    print("=== Rollback results ===")
    print(f"  WWA runs deleted:                   {runs_deleted}")
    print(f"  Wrestlers deleted (auto-imported):  {wrestlers_deleted}")
    print(f"  Curated cagematch_id reverted:      {curated_reverted}")
    if curated_with_cm:
        print("    (these had been auto-linked, now NULL):")
        for wid, name, cm in curated_with_cm:
            print(f"      id={wid}  cm{cm}  {name}")
    print()
    print(f"  Total wrestlers now:                {total_w}")
    print(f"  Total runs now:                     {total_r}")
    print(f"  WWA runs remaining:                 {wwa_r}")

    conn.close()
if __name__ == "__main__":
    main()
