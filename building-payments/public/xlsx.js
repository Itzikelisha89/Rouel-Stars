/* Minimal .xlsx writer (no dependencies): one or more sheets, RTL, styled header,
   currency cells and highlighted rows. Produces a stored (uncompressed) zip. */
(function () {
  "use strict";

  const enc = new TextEncoder();
  const xml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  /* ---------- CRC32 + zip (store) ---------- */
  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((t, p) => t + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------- styles ---------- */
  // 0 normal · 1 header · 2 money · 3 missing (red fill) · 4 total label · 5 total money · 6 title · 7 subtitle · 8 wrap text
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₪&quot;#,##0"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="15"/><color rgb="FF0F1B33"/><name val="Arial"/></font><font><sz val="10"/><color rgb="FF6B7385"/><name val="Arial"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F1B33"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBE3DF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4EAD8"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFE4DFD4"/></left><right style="thin"><color rgb="FFE4DFD4"/></right><top style="thin"><color rgb="FFE4DFD4"/></top><bottom style="thin"><color rgb="FFE4DFD4"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="9">
<xf borderId="1" applyBorder="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="164" borderId="1" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
<xf fillId="3" borderId="1" applyFill="1" applyBorder="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf fontId="2" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="2" fillId="4" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
<xf fontId="3" applyFont="1"><alignment horizontal="right" readingOrder="2"/></xf>
<xf fontId="4" applyFont="1"><alignment horizontal="right" readingOrder="2"/></xf>
<xf borderId="1" applyBorder="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const col = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  /** cells: plain value, or {v, s} with style index. Numbers become numeric cells. */
  function sheetXml(sheet) {
    const rows = sheet.rows.map((r, ri) => {
      const cells = r.map((c, ci) => {
        const cell = c && typeof c === "object" && !Array.isArray(c) ? c : { v: c };
        if (cell.v === null || cell.v === undefined || cell.v === "") return cell.s ? `<c r="${col(ci)}${ri + 1}" s="${cell.s}"/>` : "";
        const ref = `${col(ci)}${ri + 1}`, s = cell.s ? ` s="${cell.s}"` : ` s="0"`;
        return typeof cell.v === "number"
          ? `<c r="${ref}"${s}><v>${cell.v}</v></c>`
          : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(cell.v)}</t></is></c>`;
      }).join("");
      const ht = sheet.heights && sheet.heights[ri] ? ` ht="${sheet.heights[ri]}" customHeight="1"` : "";
      return `<row r="${ri + 1}"${ht}>${cells}</row>`;
    }).join("");
    const cols = (sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    const freeze = sheet.freezeRow
      ? `<pane ySplit="${sheet.freezeRow}" topLeftCell="A${sheet.freezeRow + 1}" activePane="bottomLeft" state="frozen"/>` : "";
    const merges = (sheet.merges || []).length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" rightToLeft="1">${freeze}</sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData>${merges}<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  }

  window.makeXlsx = function (sheets) {
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: STYLES },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    ];
    return zip(files);
  };
})();
