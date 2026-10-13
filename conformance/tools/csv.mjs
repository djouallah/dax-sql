// The data files of a model, as README.md's contract says: CSV with a header, every text
// quoted, a blank as an empty unquoted field, dates as YYYY-MM-DD, booleans as true/false.
export function csv(columns, rows) {
  const cell = (v, type) => {
    if (v == null) return '';
    if (type === 'string') return `"${String(v).replace(/"/g, '""')}"`;
    return String(v);
  };
  return [columns.map(([c]) => `"${c.replace(/"/g, '""')}"`).join(','),
    ...rows.map(r => r.map((v, i) => cell(v, columns[i][1])).join(','))].join('\n') + '\n';
}

// Reads such a file back: the header's names and the rows, typed by the model's columns.
export function parseCsv(text, typeOf) {
  const records = [];
  let row = [], field = '', quoted = false, inQuotes = false;
  const end = () => { row.push(quoted ? field : field === '' ? null : field); field = ''; quoted = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') inQuotes = false; else field += ch;
    } else if (ch === '"') { inQuotes = true; quoted = true; } else if (ch === ',') end();
    else if (ch === '\n') { end(); records.push(row); row = []; } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { end(); records.push(row); }
  const [header, ...rows] = records;
  const types = header.map(typeOf);
  const value = (v, type) => {
    if (v == null) return null;
    if (type === 'int64' || type === 'double' || type === 'decimal') return Number(v);
    if (type === 'boolean') return v === 'true';
    return v;
  };
  return { columns: header, rows: rows.map(r => r.map((v, i) => value(v, types[i]))) };
}
