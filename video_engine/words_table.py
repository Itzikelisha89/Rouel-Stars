import project
ed, tm, raw, sr = project.build(True)
rows = ["| # | מילה | התחלה במקור | סוף במקור | בסרטון הסופי |", "|---|---|---|---|---|"]
for i, w in enumerate(ed.words, 1):
    rows.append(f"| {i} | {w['word']} | {w['start']:.2f} | {w['end']:.2f} | {w['t']:.2f} |")
open("build/words_table.md", "w").write("\n".join(rows) + "\n")
print("\n".join(rows))
