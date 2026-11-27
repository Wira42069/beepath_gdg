// Checkpoint store. Every certificate is appended to a .jsonl file the moment it is read,
// so a crash, Ctrl+C or expired session loses at most the page in flight. Re-running
// picks up where the files leave off.
//
//   list.jsonl      one line per certificate seen on the list pages (last line per id wins)
//   details.jsonl   one line per detail page read
//   failures.jsonl  detail pages that kept failing (retried automatically next run)
//   progress.json   where the list walk stopped, page size, site total
//   archive.json    the merged result, rewritten at the end of every run
//   summary.json    counts for the last run
import fs from 'node:fs';
import path from 'node:path';

function readJsonl(file, onBadLine) {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A half-written last line after a hard kill is expected; anything else is worth a warning.
      if (i < lines.length - 2) onBadLine?.(i + 1);
    }
  });
  return rows;
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

const freshListProgress = () => ({ lastPage: 0, complete: false, pageSize: null, total: null, totalPages: null });

export class Store {
  constructor(dir, log = () => {}) {
    this.dir = path.resolve(dir);
    this.log = log;
    this.files = {
      list: path.join(this.dir, 'list.jsonl'),
      details: path.join(this.dir, 'details.jsonl'),
      failures: path.join(this.dir, 'failures.jsonl'),
      progress: path.join(this.dir, 'progress.json'),
      archive: path.join(this.dir, 'archive.json'),
      summary: path.join(this.dir, 'summary.json'),
    };
    this.tick = 0; // bumps on every saved record; lets the runner tell "stuck" from "slow"
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const warn = (name) => (line) => this.log(`! Skipped a damaged line ${line} in ${name}`);
    this.list = new Map();
    for (const row of readJsonl(this.files.list, warn('list.jsonl'))) if (row.archiveId) this.list.set(row.archiveId, row);
    this.details = new Map();
    for (const row of readJsonl(this.files.details, warn('details.jsonl'))) if (row.archiveId) this.details.set(row.archiveId, row);
    this.failures = new Map();
    for (const row of readJsonl(this.files.failures, warn('failures.jsonl'))) {
      if (row.archiveId && !this.details.has(row.archiveId)) this.failures.set(row.archiveId, row);
    }
    this.progress = fs.existsSync(this.files.progress)
      ? JSON.parse(fs.readFileSync(this.files.progress, 'utf8'))
      : { version: 1, createdAt: new Date().toISOString(), list: freshListProgress() };
    this.progress.list = { ...freshListProgress(), ...this.progress.list };
    return this;
  }

  saveProgress() {
    this.progress.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.files.progress, this.progress);
  }

  setListMeta({ pageSize, total, totalPages }) {
    Object.assign(this.progress.list, { pageSize, total, totalPages });
    this.saveProgress();
  }

  addListPage(items, pageNumber) {
    if (items.length) fs.appendFileSync(this.files.list, items.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    for (const item of items) if (item.archiveId) this.list.set(item.archiveId, item);
    this.progress.list.lastPage = pageNumber;
    this.saveProgress();
    this.tick += 1;
  }

  completeList() {
    this.progress.list.complete = true;
    this.progress.list.completedAt = new Date().toISOString();
    this.saveProgress();
  }

  /** Walk the list again from page 1 (new and edited entries); keeps everything already saved. */
  restartList() {
    this.progress.list = { ...freshListProgress(), pageSize: this.progress.list.pageSize };
    this.saveProgress();
  }

  addDetail(detail) {
    fs.appendFileSync(this.files.details, JSON.stringify(detail) + '\n', 'utf8');
    this.details.set(detail.archiveId, detail);
    this.failures.delete(detail.archiveId);
    this.tick += 1;
  }

  addFailure(archiveId, error) {
    const row = { archiveId, error: String(error).split('\n')[0].slice(0, 300), at: new Date().toISOString() };
    fs.appendFileSync(this.files.failures, JSON.stringify(row) + '\n', 'utf8');
    this.failures.set(archiveId, row);
  }

  /** Certificates on the list that have no detail yet, in archive order. */
  pendingDetailIds() {
    return [...this.list.values()]
      .filter((r) => !this.details.has(r.archiveId))
      .sort((a, b) => a.archivePosition - b.archivePosition)
      .map((r) => r.archiveId);
  }

  merged() {
    return [...this.list.values()]
      .sort((a, b) => a.archivePosition - b.archivePosition)
      .map((l) => {
        const d = this.details.get(l.archiveId);
        return {
          archiveId: l.archiveId,
          code: d?.code ?? l.code,
          title: d?.title || l.title,
          creditEarning: l.creditEarning,
          description: d ? d.description : l.description,
          descriptionTruncated: d ? false : l.descriptionTruncated,
          learningOutcomes: d ? d.learningOutcomes : l.learningOutcomes,
          learningOutcomesTruncated: d ? false : l.learningOutcomesTruncated,
          administrator: d?.administrator ?? l.administrator,
          institution: d?.institution ?? l.institution,
          duration: d?.duration ?? l.duration,
          creditOptions: d ? d.creditOptions : null,
          archivePosition: l.archivePosition,
          detailScraped: Boolean(d),
          listScrapedAt: l.scrapedAt,
          detailScrapedAt: d?.scrapedAt ?? null,
        };
      });
  }

  writeArchive() {
    const rows = this.merged();
    writeJsonAtomic(this.files.archive, rows);
    const total = this.progress.list.total;
    const summary = {
      writtenAt: new Date().toISOString(),
      siteReportedTotal: total,
      certificates: rows.length,
      missingFromList: total == null ? null : Math.max(0, total - rows.length),
      listComplete: this.progress.list.complete,
      listPagesDone: this.progress.list.lastPage,
      listPagesTotal: this.progress.list.totalPages,
      withDetails: rows.filter((r) => r.detailScraped).length,
      detailFailures: this.failures.size,
      stillTruncated: rows.filter((r) => r.descriptionTruncated).length,
      creditEarningOptions: rows.filter((r) => (r.creditOptions ?? []).some((o) => o.mapId && o.mapId !== 'noncredit')).length,
    };
    writeJsonAtomic(this.files.summary, summary);
    return summary;
  }
}
